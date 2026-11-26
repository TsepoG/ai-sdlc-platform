// @ts-check
import { Aws, Stack } from 'aws-cdk-lib';
import {
  OidcProviderNative,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { APP_NAME, CDK_BOOTSTRAP_QUALIFIER, DEPLOY_BRANCH, PLATFORM_ENVS } from './constants.js';

const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';
const STS_AUDIENCE = 'sts.amazonaws.com';

const SUBJECT_PREFIX_START = 'repo:';

/**
 * @typedef {object} GithubOidcStackProps
 * @property {string} githubSubjectPrefix The repo's OIDC `sub` prefix exactly as GitHub issues
 *   it, e.g. `repo:<owner>@<ownerId>/<repo>@<repoId>` with immutable subject claims.
 */

/**
 * The `sub` claims allowed to assume the role: the main branch, and each GitHub environment.
 * Jobs that declare `environment:` carry the environment sub, not the branch, so the
 * environments' deployment-branch policy (set in GitHub) is what pins them to main.
 * @param {string} subjectPrefix The repo's OIDC `sub` prefix (see GithubOidcStackProps).
 * @returns {string[]} Exact `sub` values.
 * @throws {Error} When the prefix does not start with `repo:`.
 */
export function allowedSubjects(subjectPrefix) {
  if (!subjectPrefix.startsWith(SUBJECT_PREFIX_START)) {
    throw new Error(`GitHub subject prefix must start with "${SUBJECT_PREFIX_START}"`);
  }
  return [
    `${subjectPrefix}:ref:refs/heads/${DEPLOY_BRANCH}`,
    ...PLATFORM_ENVS.map((name) => `${subjectPrefix}:environment:${name}`),
  ];
}

/** GitHub Actions OIDC provider and the deploy role GitHub workflows assume (once per account). */
export class GithubOidcStack extends Stack {
  /**
   * Create the OIDC stack.
   * @param {import('constructs').Construct} scope Parent construct.
   * @param {string} id Stack ID.
   * @param {GithubOidcStackProps & import('aws-cdk-lib').StackProps} props Stack settings.
   */
  constructor(scope, id, { githubSubjectPrefix, ...stackProps }) {
    super(scope, id, stackProps);
    const subjects = allowedSubjects(githubSubjectPrefix);

    const provider = new OidcProviderNative(this, 'GithubProvider', {
      url: `https://${GITHUB_OIDC_HOST}`,
      clientIds: [STS_AUDIENCE],
    });

    this.deployRole = new Role(this, 'DeployRole', {
      roleName: `${APP_NAME}-github-deploy`,
      description: `Assumed by GitHub Actions (${githubSubjectPrefix}) to deploy the platform.`,
      assumedBy: new WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: STS_AUDIENCE,
          [`${GITHUB_OIDC_HOST}:sub`]: subjects,
        },
      }),
    });

    // `cdk deploy` does its work through the roles `cdk bootstrap` created.
    this.deployRole.addToPolicy(
      new PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/cdk-${CDK_BOOTSTRAP_QUALIFIER}-*`,
        ],
      }),
    );
    // GetAuthorizationToken does not support resource-level permissions.
    this.deployRole.addToPolicy(
      new PolicyStatement({ actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }),
    );
    this.deployRole.addToPolicy(
      new PolicyStatement({
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:CompleteLayerUpload',
          'ecr:DescribeImages',
          'ecr:GetDownloadUrlForLayer',
          'ecr:InitiateLayerUpload',
          'ecr:PutImage',
          'ecr:UploadLayerPart',
        ],
        resources: [
          `arn:${Aws.PARTITION}:ecr:${Aws.REGION}:${Aws.ACCOUNT_ID}:repository/${APP_NAME}-*`,
        ],
      }),
    );
  }
}
