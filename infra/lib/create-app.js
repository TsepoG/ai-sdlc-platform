// @ts-check
import { App } from 'aws-cdk-lib';
import {
  APP_NAME,
  DEFAULT_GITHUB_REPO,
  ENV_SETTINGS,
  PLACEHOLDER_IMAGE_TAG,
  PLATFORM_ENVS,
} from './constants.js';
import { GithubOidcStack } from './github-oidc-stack.js';
import { PlatformStack } from './platform-stack.js';
import { RegistryStack } from './registry-stack.js';

/**
 * Read a CDK context value as a string, falling back to a default.
 * @param {App} app CDK app.
 * @param {string} key Context key (`-c key=value`).
 * @param {string} fallback Value when the key is unset or empty.
 * @returns {string} Context value.
 */
function contextString(app, key, fallback) {
  const value = app.node.tryGetContext(key);
  return typeof value === 'string' && value !== '' ? value : fallback;
}

/**
 * Build the CDK app. Stacks set no `env`, so synth needs no AWS credentials and account and
 * region come from the deploying credentials.
 * @param {App} [app] CDK app to populate (defaults to a new one).
 * @returns {{ app: App, stacks: import('aws-cdk-lib').Stack[] }} The app and the stacks added to it.
 * @throws {Error} When `platformEnv` is not a known platform environment.
 */
export function createApp(app = new App()) {
  const platformEnv = contextString(app, 'platformEnv', 'platform-dev');
  if (!(platformEnv in ENV_SETTINGS)) {
    throw new Error(
      `Unknown platformEnv "${platformEnv}"; expected one of: ${PLATFORM_ENVS.join(', ')}`,
    );
  }
  const env = /** @type {keyof typeof ENV_SETTINGS} */ (platformEnv);

  const stacks = [
    new RegistryStack(app, `${APP_NAME}-registry-${env}`, { platformEnv: env }),
    new PlatformStack(app, `${APP_NAME}-${env}`, {
      platformEnv: env,
      imageTag: contextString(app, 'imageTag', PLACEHOLDER_IMAGE_TAG),
    }),
    new GithubOidcStack(app, `${APP_NAME}-github-oidc`, {
      githubRepo: contextString(app, 'githubRepo', DEFAULT_GITHUB_REPO),
    }),
  ];
  return { app, stacks };
}
