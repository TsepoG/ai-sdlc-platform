// @ts-check
import { CfnOutput, Duration, SecretValue, Stack } from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Cluster, ContainerImage, ContainerInsights, LogDrivers } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import {
  APP_NAME,
  CONTAINER_PORT,
  ENV_SETTINGS,
  HEALTH_PATH,
  repositoryName,
} from './constants.js';

const MAX_AZS = 2;
const TASK_CPU = 256;
const TASK_MEMORY_MIB = 512;
const HEALTH_CHECK_GRACE_SECONDS = 60;
const HEALTH_CHECK_INTERVAL_SECONDS = 15;
const PLACEHOLDER_SECRET_VALUE = 'REPLACE_ME_SET_MANUALLY';

/**
 * @typedef {object} PlatformStackProps
 * @property {keyof typeof ENV_SETTINGS} platformEnv Platform environment name.
 * @property {string} imageTag Image tag (commit SHA) to run from the registry.
 */

/** VPC, ECS cluster and a Fargate service behind an ALB, for one platform environment. */
export class PlatformStack extends Stack {
  /**
   * Create the platform stack.
   * @param {import('constructs').Construct} scope Parent construct.
   * @param {string} id Stack ID.
   * @param {PlatformStackProps & import('aws-cdk-lib').StackProps} props Stack settings.
   */
  constructor(scope, id, { platformEnv, imageTag, ...stackProps }) {
    super(scope, id, stackProps);
    const settings = ENV_SETTINGS[platformEnv];

    const vpc = new Vpc(this, 'Vpc', { maxAzs: MAX_AZS, natGateways: settings.natGateways });
    const cluster = new Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: settings.containerInsights
        ? ContainerInsights.ENABLED
        : ContainerInsights.DISABLED,
    });
    const logGroup = new LogGroup(this, 'LogGroup', { retention: RetentionDays.ONE_MONTH });

    // Created here and filled in by hand. Not injected into the task yet: the model provider
    // route (Anthropic API vs Bedrock) is undecided, and Bedrock would need no key.
    this.modelApiKeySecret = new Secret(this, 'ModelApiKeySecret', {
      secretName: `${APP_NAME}/${platformEnv}/model-api-key`,
      description: 'Model provider API key. Placeholder: set the real value manually.',
      secretStringValue: SecretValue.unsafePlainText(PLACEHOLDER_SECRET_VALUE),
    });

    // Imported by name so this stack does not depend on RegistryStack being in the same app run.
    const repository = Repository.fromRepositoryName(
      this,
      'Repository',
      repositoryName(platformEnv),
    );

    this.service = new ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      cpu: TASK_CPU,
      memoryLimitMiB: TASK_MEMORY_MIB,
      desiredCount: settings.desiredCount,
      publicLoadBalancer: true,
      healthCheckGracePeriod: Duration.seconds(HEALTH_CHECK_GRACE_SECONDS),
      // Keep the old task until the new one is healthy, so a bad deploy never reduces capacity.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      taskImageOptions: {
        image: ContainerImage.fromEcrRepository(repository, imageTag),
        containerPort: CONTAINER_PORT,
        logDriver: LogDrivers.awsLogs({ streamPrefix: APP_NAME, logGroup }),
        environment: {
          NODE_ENV: 'production',
          PORT: String(CONTAINER_PORT),
          LOG_LEVEL: 'info',
          APP_VERSION: imageTag,
          PLATFORM_ENV: platformEnv,
        },
      },
    });
    this.service.targetGroup.configureHealthCheck({
      path: HEALTH_PATH,
      interval: Duration.seconds(HEALTH_CHECK_INTERVAL_SECONDS),
    });

    new CfnOutput(this, 'ServiceUrl', {
      value: `http://${this.service.loadBalancer.loadBalancerDnsName}`,
      description: 'Public ALB URL (HTTP only; put behind SSO before real data).',
    });
  }
}
