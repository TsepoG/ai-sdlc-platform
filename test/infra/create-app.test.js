// @ts-check
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../infra/lib/index.js';

/**
 * Build the app with context and list the stack names it contains.
 * @param {Record<string, string>} context CDK context values.
 * @returns {string[]} Stack names.
 */
function stackNames(context) {
  return createApp(new App({ context })).stacks.map((stack) => stack.node.id);
}

describe('createApp', () => {
  it('defaults to platform-dev with registry, platform and OIDC stacks', () => {
    expect(stackNames({})).toEqual([
      'ai-sdlc-platform-registry-platform-dev',
      'ai-sdlc-platform-platform-dev',
      'ai-sdlc-platform-github-oidc',
    ]);
  });

  it('names stacks for the requested platform environment', () => {
    expect(stackNames({ platformEnv: 'platform-prod' })).toContain(
      'ai-sdlc-platform-platform-prod',
    );
  });

  it('refuses an unknown platform environment', () => {
    expect(() => stackNames({ platformEnv: 'staging' })).toThrow(/Unknown platformEnv "staging"/);
  });

  it('does not pin an account or region, so synth needs no credentials', () => {
    const { stacks } = createApp(new App());

    for (const stack of stacks) {
      expect(stack.environment).toBe('aws://unknown-account/unknown-region');
    }
  });

  it('accepts githubSubjectPrefix and imageTag context overrides', () => {
    expect(() =>
      stackNames({ githubSubjectPrefix: 'repo:acme@1/other@2', imageTag: 'abc123' }),
    ).not.toThrow();
  });

  it('trusts the immutable subject prefix of this repo by default', () => {
    const { stacks } = createApp(new App());
    const oidcStack = stacks.find((stack) => stack.node.id === 'ai-sdlc-platform-github-oidc');

    const roles = Template.fromStack(
      /** @type {import('aws-cdk-lib').Stack} */ (oidcStack),
    ).findResources('AWS::IAM::Role');

    expect(JSON.stringify(roles)).toContain(
      'repo:TsepoG@66557542/ai-sdlc-platform@1423470779:environment:platform-dev',
    );
  });
});
