// @ts-check
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { RegistryStack } from '../../infra/lib/index.js';

/**
 * Synthesize a registry stack.
 * @param {string} platformEnv Platform environment name.
 * @returns {Template} Synthesized template.
 */
function synth(platformEnv) {
  return Template.fromStack(new RegistryStack(new App(), 'Registry', { platformEnv }));
}

describe('RegistryStack', () => {
  it('creates one scanned, immutable repository named for the environment', () => {
    const template = synth('platform-dev');

    expect(() => template.resourceCountIs('AWS::ECR::Repository', 1)).not.toThrow();
    expect(() =>
      template.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: 'ai-sdlc-platform-platform-dev',
        ImageScanningConfiguration: { ScanOnPush: true },
        ImageTagMutability: 'IMMUTABLE',
      }),
    ).not.toThrow();
  });

  it('expires untagged images and caps the tagged image count', () => {
    const template = synth('platform-prod');

    const [repository] = Object.values(template.findResources('AWS::ECR::Repository'));
    const policy = JSON.parse(repository.Properties.LifecyclePolicy.LifecyclePolicyText);
    expect(policy.rules).toHaveLength(2);
    expect(policy.rules[0].selection).toMatchObject({ tagStatus: 'untagged' });
    expect(policy.rules[1].selection).toMatchObject({
      tagStatus: 'any',
      countType: 'imageCountMoreThan',
    });
  });
});
