// @ts-check
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { PlatformStack } from '../../infra/lib/index.js';

/** @type {Map<string, Template>} */
const cache = new Map();

/**
 * Synthesize (once per environment) a platform stack.
 * @param {'platform-dev' | 'platform-prod'} platformEnv Platform environment name.
 * @returns {Template} Synthesized template.
 */
function synth(platformEnv) {
  const cached = cache.get(platformEnv);
  if (cached !== undefined) {
    return cached;
  }
  const template = Template.fromStack(
    new PlatformStack(new App(), 'Platform', { platformEnv, imageTag: 'abc1234' }),
  );
  cache.set(platformEnv, template);
  return template;
}

/**
 * The single resource of a type.
 * @param {Template} template Template.
 * @param {string} type CloudFormation type.
 */
function only(template, type) {
  const resources = Object.values(template.findResources(type));
  expect(resources).toHaveLength(1);
  return resources[0];
}

/**
 * The service container's definition.
 * @param {Template} template Template.
 */
function container(template) {
  return only(template, 'AWS::ECS::TaskDefinition').Properties.ContainerDefinitions[0];
}

describe('RDS for PostgreSQL', () => {
  it('runs PostgreSQL 17 on the smallest Graviton class, encrypted and private', () => {
    const db = only(synth('platform-dev'), 'AWS::RDS::DBInstance').Properties;

    expect(db).toMatchObject({
      Engine: 'postgres',
      EngineVersion: '17',
      DBInstanceClass: 'db.t4g.micro',
      StorageEncrypted: true,
      PubliclyAccessible: false,
      BackupRetentionPeriod: 7,
      StorageType: 'gp3',
    });
  });

  it('places the database in isolated subnets', () => {
    const template = synth('platform-dev');
    const group = only(template, 'AWS::RDS::DBSubnetGroup').Properties;

    const isolated = Object.entries(template.findResources('AWS::EC2::Subnet'))
      .filter(([, subnet]) =>
        subnet.Properties.Tags.some(
          (/** @type {{ Key: string, Value: string }} */ tag) =>
            tag.Key === 'aws-cdk:subnet-type' && tag.Value === 'Isolated',
        ),
      )
      .map(([id]) => ({ Ref: id }));
    expect(isolated).toHaveLength(2);
    expect(group.SubnetIds).toEqual(isolated);
  });

  it('is single-AZ, unprotected and destroyed with the stack in dev', () => {
    const db = only(synth('platform-dev'), 'AWS::RDS::DBInstance');

    expect(db.Properties.MultiAZ).toBe(false);
    expect(db.Properties.DeletionProtection).toBe(false);
    expect(db.DeletionPolicy).toBe('Delete');
  });

  it('is multi-AZ, deletion-protected and snapshotted on delete in prod', () => {
    const db = only(synth('platform-prod'), 'AWS::RDS::DBInstance');

    expect(db.Properties.MultiAZ).toBe(true);
    expect(db.Properties.DeletionProtection).toBe(true);
    expect(db.DeletionPolicy).toBe('Snapshot');
  });

  it('generates its credentials into a named Secrets Manager secret', () => {
    expect(() =>
      synth('platform-dev').hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: 'ai-sdlc-platform/platform-dev/db',
        GenerateSecretString: Match.objectLike({ GenerateStringKey: 'password' }),
      }),
    ).not.toThrow();
  });

  it('admits only the service, only on 5432', () => {
    const template = synth('platform-dev');
    const rules = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress')).filter(
      (rule) => rule.Properties.FromPort === 5432,
    );

    expect(rules).toHaveLength(1);
    expect(rules[0].Properties).toMatchObject({ ToPort: 5432, IpProtocol: 'tcp' });
    expect(rules[0].Properties.SourceSecurityGroupId).toBeDefined();
    expect(rules[0].Properties.CidrIp).toBeUndefined();
  });
});

describe('the service and the database', () => {
  it('reads the database connection from secret fields, not the whole secret', () => {
    const secrets = container(synth('platform-dev')).Secrets;

    expect(secrets.map((/** @type {{ Name: string }} */ secret) => secret.Name).sort()).toEqual([
      'DATABASE_HOST',
      'DATABASE_NAME',
      'DATABASE_PASSWORD',
      'DATABASE_PORT',
      'DATABASE_USER',
    ]);
    const fields = secrets.map((/** @type {{ ValueFrom: unknown }} */ secret) =>
      JSON.stringify(secret.ValueFrom),
    );
    expect(
      fields.every((/** @type {string} */ field) =>
        /:(host|port|dbname|username|password)::/.test(field),
      ),
    ).toBe(true);
  });

  it('never puts a password in the plain environment', () => {
    const environment = container(synth('platform-dev')).Environment;

    expect(environment.map((/** @type {{ Name: string }} */ entry) => entry.Name)).not.toContain(
      'DATABASE_PASSWORD',
    );
  });

  it('verifies TLS to the database and uses the S3 content store', () => {
    const environment = container(synth('platform-dev')).Environment;

    expect(environment).toEqual(
      expect.arrayContaining([
        { Name: 'DATABASE_SSL', Value: 'true' },
        { Name: 'CONTENT_STORE', Value: 's3' },
        expect.objectContaining({ Name: 'CONTENT_BUCKET' }),
      ]),
    );
  });

  it('never enables the workflow API or dev auth in a deployed environment', () => {
    const names = container(synth('platform-dev')).Environment.map(
      (/** @type {{ Name: string }} */ entry) => entry.Name,
    );

    expect(names).not.toContain('WORKFLOW_API_ENABLED');
    expect(names).not.toContain('AUTH_MODE');
  });

  it('lets only the execution role read the database secret', () => {
    const template = synth('platform-dev');
    const taskRole = only(template, 'AWS::ECS::TaskDefinition').Properties.TaskRoleArn;
    const taskRoleId = taskRole['Fn::GetAtt'][0];

    const secretReaders = Object.values(template.findResources('AWS::IAM::Policy')).filter(
      (policy) =>
        JSON.stringify(policy.Properties.PolicyDocument).includes('secretsmanager:GetSecretValue'),
    );
    expect(secretReaders.length).toBeGreaterThan(0);
    for (const policy of secretReaders) {
      expect(policy.Properties.Roles).not.toContainEqual({ Ref: taskRoleId });
    }
  });
});

describe('S3 artifact bucket', () => {
  it('blocks public access, encrypts, versions and is not a website', () => {
    const bucket = only(synth('platform-dev'), 'AWS::S3::Bucket').Properties;

    expect(bucket.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(bucket.BucketEncryption.ServerSideEncryptionConfiguration[0]).toMatchObject({
      ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
    });
    expect(bucket.VersioningConfiguration).toEqual({ Status: 'Enabled' });
    expect(bucket.WebsiteConfiguration).toBeUndefined();
  });

  it('refuses requests without TLS', () => {
    const policy = only(synth('platform-dev'), 'AWS::S3::BucketPolicy').Properties.PolicyDocument;

    expect(policy.Statement).toContainEqual(
      expect.objectContaining({
        Effect: 'Deny',
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    );
  });

  it('is retained in prod and destroyed with its objects in dev', () => {
    expect(only(synth('platform-prod'), 'AWS::S3::Bucket').DeletionPolicy).toBe('Retain');
    expect(only(synth('platform-dev'), 'AWS::S3::Bucket').DeletionPolicy).toBe('Delete');
    expect(() =>
      synth('platform-dev').resourceCountIs('Custom::S3AutoDeleteObjects', 1),
    ).not.toThrow();
    expect(() =>
      synth('platform-prod').resourceCountIs('Custom::S3AutoDeleteObjects', 0),
    ).not.toThrow();
  });

  it('lets the task role read and write objects, but not delete them', () => {
    const template = synth('platform-dev');
    const taskRole = only(template, 'AWS::ECS::TaskDefinition').Properties.TaskRoleArn;
    const taskRoleId = taskRole['Fn::GetAtt'][0];

    const taskPolicies = Object.values(template.findResources('AWS::IAM::Policy')).filter(
      (policy) =>
        policy.Properties.Roles.some(
          (/** @type {{ Ref: string }} */ role) => role.Ref === taskRoleId,
        ),
    );
    const actions = taskPolicies.flatMap((policy) =>
      policy.Properties.PolicyDocument.Statement.flatMap(
        (/** @type {{ Action: string | string[] }} */ statement) => [statement.Action].flat(),
      ),
    );
    expect(actions).toEqual(expect.arrayContaining(['s3:GetObject*', 's3:PutObject']));
    expect(actions.some((/** @type {string} */ action) => action.startsWith('s3:Delete'))).toBe(
      false,
    );
    expect(
      actions.some((/** @type {string} */ action) => action.startsWith('secretsmanager:')),
    ).toBe(false);
  });
});
