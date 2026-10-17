// @ts-check
import { Duration, Stack } from 'aws-cdk-lib';
import { Repository, TagMutability, TagStatus } from 'aws-cdk-lib/aws-ecr';
import { repositoryName } from './constants.js';

const KEEP_TAGGED_IMAGES = 20;
const UNTAGGED_EXPIRY_DAYS = 7;

/**
 * @typedef {object} RegistryStackProps
 * @property {string} platformEnv Platform environment this registry serves.
 */

/** ECR repository for one platform environment. Deployed first so the image can be pushed. */
export class RegistryStack extends Stack {
  /**
   * Create the registry stack.
   * @param {import('constructs').Construct} scope Parent construct.
   * @param {string} id Stack ID.
   * @param {RegistryStackProps & import('aws-cdk-lib').StackProps} props Stack settings.
   */
  constructor(scope, id, { platformEnv, ...stackProps }) {
    super(scope, id, stackProps);
    this.repository = new Repository(this, 'Repository', {
      repositoryName: repositoryName(platformEnv),
      imageScanOnPush: true,
      // Tags are commit SHAs; immutability stops a tag from being silently repointed.
      imageTagMutability: TagMutability.IMMUTABLE,
      lifecycleRules: [
        {
          rulePriority: 1,
          description: 'Expire untagged images',
          tagStatus: TagStatus.UNTAGGED,
          maxImageAge: Duration.days(UNTAGGED_EXPIRY_DAYS),
        },
        {
          rulePriority: 2,
          description: 'Keep the most recent images',
          tagStatus: TagStatus.ANY,
          maxImageCount: KEEP_TAGGED_IMAGES,
        },
      ],
    });
  }
}
