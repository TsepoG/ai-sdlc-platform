// @ts-check
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  SecurityGroup,
  SubnetType,
} from 'aws-cdk-lib/aws-ec2';
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType,
} from 'aws-cdk-lib/aws-rds';
import { APP_NAME } from './constants.js';

/** Major version only, so RDS applies the latest minor; the owner confirmed 17 is offered in af-south-1. */
const POSTGRES_VERSION = PostgresEngineVersion.VER_17;
/** PostgreSQL's port; the security group rule names it explicitly. */
export const POSTGRES_PORT = 5432;
const DATABASE_NAME = 'platform';
const DATABASE_USER = 'platform';
const ALLOCATED_STORAGE_GB = 20;
const BACKUP_RETENTION_DAYS = 7;

/**
 * Create the platform database: RDS for PostgreSQL on the smallest Graviton class, private,
 * encrypted, with 7-day backups. Prod adds multi-AZ, deletion protection and a final snapshot.
 * @param {import('constructs').Construct} scope Parent construct.
 * @param {object} props Database settings.
 * @param {import('aws-cdk-lib/aws-ec2').IVpc} props.vpc VPC with isolated subnets.
 * @param {string} props.platformEnv Platform environment name.
 * @param {boolean} props.protectData Whether prod-only protections apply.
 * @returns {DatabaseInstance} The database.
 */
export function createDatabase(scope, { vpc, platformEnv, protectData }) {
  // The database only answers connections; it never needs to open one.
  const securityGroup = new SecurityGroup(scope, 'DatabaseSecurityGroup', {
    vpc,
    description: 'Platform database: inbound from the service only, no outbound',
    allowAllOutbound: false,
  });
  return new DatabaseInstance(scope, 'Database', {
    engine: DatabaseInstanceEngine.postgres({ version: POSTGRES_VERSION }),
    instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
    vpc,
    vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    securityGroups: [securityGroup],
    publiclyAccessible: false,
    port: POSTGRES_PORT,
    databaseName: DATABASE_NAME,
    credentials: Credentials.fromGeneratedSecret(DATABASE_USER, {
      secretName: `${APP_NAME}/${platformEnv}/db`,
    }),
    allocatedStorage: ALLOCATED_STORAGE_GB,
    storageType: StorageType.GP3,
    storageEncrypted: true,
    backupRetention: Duration.days(BACKUP_RETENTION_DAYS),
    multiAz: protectData,
    deletionProtection: protectData,
    removalPolicy: protectData ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
    // CloudFormation deletes automated backups with the instance by default; keep them in prod.
    deleteAutomatedBackups: protectData ? false : undefined,
  });
}
