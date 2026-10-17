// @ts-check
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { PlatformStack } from '../../infra/lib/index.js';

/**
 * Synthesize a platform stack.
 * @param {'platform-dev' | 'platform-prod'} platformEnv Platform environment name.
 * @param {string} [imageTag] Image tag to deploy.
 * @returns {Template} Synthesized template.
 */
function synth(platformEnv, imageTag = 'abc1234') {
  return Template.fromStack(new PlatformStack(new App(), 'Platform', { platformEnv, imageTag }));
}

describe('PlatformStack', () => {
  it('rolls back failed deployments with the circuit breaker', () => {
    expect(() =>
      synth('platform-dev').hasResourceProperties('AWS::ECS::Service', {
        DeploymentConfiguration: Match.objectLike({
          DeploymentCircuitBreaker: { Enable: true, Rollback: true },
          MinimumHealthyPercent: 100,
        }),
      }),
    ).not.toThrow();
  });

  it('health-checks the ALB target group on /health', () => {
    expect(() =>
      synth('platform-dev').hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
        HealthCheckPath: '/health',
      }),
    ).not.toThrow();
  });

  it('spreads the VPC over two availability zones', () => {
    const template = synth('platform-dev');

    // 2 public + 2 private subnets.
    expect(() => template.resourceCountIs('AWS::EC2::Subnet', 4)).not.toThrow();
  });

  it('runs the requested image tag and passes it as APP_VERSION with the environment name', () => {
    const template = synth('platform-prod', 'deadbeef');

    const [task] = Object.values(template.findResources('AWS::ECS::TaskDefinition'));
    const environment = task.Properties.ContainerDefinitions[0].Environment;
    expect(environment).toEqual(
      expect.arrayContaining([
        { Name: 'APP_VERSION', Value: 'deadbeef' },
        { Name: 'PLATFORM_ENV', Value: 'platform-prod' },
        { Name: 'PORT', Value: '8080' },
      ]),
    );
    expect(JSON.stringify(template.toJSON())).toContain(':deadbeef');
  });

  it('creates a placeholder model API key secret that is not wired into the task', () => {
    const template = synth('platform-dev');

    expect(() =>
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: 'ai-sdlc-platform/platform-dev/model-api-key',
      }),
    ).not.toThrow();
    const [task] = Object.values(template.findResources('AWS::ECS::TaskDefinition'));
    expect(task.Properties.ContainerDefinitions[0].Secrets).toBeUndefined();
  });

  it('uses one NAT gateway and no Container Insights in dev', () => {
    const template = synth('platform-dev');

    expect(() => template.resourceCountIs('AWS::EC2::NatGateway', 1)).not.toThrow();
    expect(() =>
      template.hasResourceProperties('AWS::ECS::Cluster', {
        ClusterSettings: [{ Name: 'containerInsights', Value: 'disabled' }],
      }),
    ).not.toThrow();
  });

  it('uses two NAT gateways and Container Insights in prod', () => {
    const template = synth('platform-prod');

    expect(() => template.resourceCountIs('AWS::EC2::NatGateway', 2)).not.toThrow();
    expect(() =>
      template.hasResourceProperties('AWS::ECS::Cluster', {
        ClusterSettings: [{ Name: 'containerInsights', Value: 'enabled' }],
      }),
    ).not.toThrow();
  });

  it('outputs the service URL', () => {
    expect(() => synth('platform-dev').hasOutput('ServiceUrl', {})).not.toThrow();
  });
});
