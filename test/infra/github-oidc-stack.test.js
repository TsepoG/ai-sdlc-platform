// @ts-check
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GithubOidcStack, allowedSubjects } from '../../infra/lib/index.js';

const PREFIX = 'repo:acme@111/ai-sdlc-platform@222';
const HOST = 'token.actions.githubusercontent.com';

/**
 * Synthesize the OIDC stack.
 * @returns {Template} Synthesized template.
 */
function synth() {
  return Template.fromStack(
    new GithubOidcStack(new App(), 'Oidc', { githubSubjectPrefix: PREFIX }),
  );
}

describe('allowedSubjects', () => {
  it('lists main and both platform environments in the immutable subject format', () => {
    expect(allowedSubjects(PREFIX)).toEqual([
      'repo:acme@111/ai-sdlc-platform@222:ref:refs/heads/main',
      'repo:acme@111/ai-sdlc-platform@222:environment:platform-dev',
      'repo:acme@111/ai-sdlc-platform@222:environment:platform-prod',
    ]);
  });

  it('refuses a prefix that is not a GitHub repo subject', () => {
    expect(() => allowedSubjects('acme/ai-sdlc-platform')).toThrow(/must start with "repo:"/);
  });
});

describe('GithubOidcStack', () => {
  it('registers the GitHub OIDC provider for the STS audience', () => {
    expect(() =>
      synth().hasResourceProperties('AWS::IAM::OIDCProvider', {
        Url: `https://${HOST}`,
        ClientIdList: ['sts.amazonaws.com'],
      }),
    ).not.toThrow();
  });

  it('trusts only this repo main branch and its platform environments', () => {
    expect(() =>
      synth().hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            Match.objectLike({
              Action: 'sts:AssumeRoleWithWebIdentity',
              Condition: {
                StringEquals: {
                  [`${HOST}:aud`]: 'sts.amazonaws.com',
                  [`${HOST}:sub`]: allowedSubjects(PREFIX),
                },
              },
            }),
          ],
        },
      }),
    ).not.toThrow();
  });

  it('limits what the role can do to bootstrap roles and platform repositories', () => {
    const template = synth();

    const [policy] = Object.values(template.findResources('AWS::IAM::Policy'));
    /** @type {{ Resource: unknown, Action: unknown }[]} */
    const statements = policy.Properties.PolicyDocument.Statement;
    const unscoped = statements.filter((statement) => statement.Resource === '*');
    expect(unscoped).toHaveLength(1);
    expect(unscoped[0].Action).toBe('ecr:GetAuthorizationToken');
    expect(JSON.stringify(statements)).toContain('role/cdk-hnb659fds-*');
    expect(JSON.stringify(statements)).toContain('repository/ai-sdlc-platform-*');
  });
});
