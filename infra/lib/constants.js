// @ts-check

/** Prefix for every platform resource name. */
export const APP_NAME = 'ai-sdlc-platform';

/** Port the container listens on (matches the Dockerfile). */
export const CONTAINER_PORT = 8080;

/** Path the ALB target group and the deploy smoke test probe. */
export const HEALTH_PATH = '/health';

/** Image tag used for synth and tests, before CI supplies a real commit SHA. */
export const PLACEHOLDER_IMAGE_TAG = 'synth-placeholder';

/** GitHub `<owner>/<repo>` the deploy role trusts; override with `-c githubRepo=...`. */
export const DEFAULT_GITHUB_REPO = 'TsepoG/ai-sdlc-platform';

/** Default branch the deploy role trusts for jobs that run without a GitHub environment. */
export const DEPLOY_BRANCH = 'main';

/** Default CDK bootstrap qualifier; the deploy role may assume roles that carry it. */
export const CDK_BOOTSTRAP_QUALIFIER = 'hnb659fds';

/**
 * @typedef {object} EnvSettings
 * @property {number} natGateways NAT gateways in the VPC (cost vs. availability).
 * @property {boolean} containerInsights Whether ECS Container Insights is on.
 * @property {number} desiredCount Fargate tasks to run.
 */

/** Per-environment sizing, keyed by platform environment name. */
export const ENV_SETTINGS = /** @type {const} */ ({
  'platform-dev': { natGateways: 1, containerInsights: false, desiredCount: 1 },
  'platform-prod': { natGateways: 2, containerInsights: true, desiredCount: 2 },
});

/** Platform environments the stacks can be synthesised for. */
export const PLATFORM_ENVS = /** @type {(keyof typeof ENV_SETTINGS)[]} */ (
  Object.keys(ENV_SETTINGS)
);

/**
 * Name of the ECR repository for a platform environment.
 * @param {string} platformEnv Platform environment name.
 * @returns {string} Repository name.
 */
export function repositoryName(platformEnv) {
  return `${APP_NAME}-${platformEnv}`;
}
