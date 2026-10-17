// @ts-check
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GithubOidcStack, allowedSubjects } from '../../infra/lib/index.js';

const REPO = 'acme/ai-sdlc-platform';
const HOST = 'token.actions.githubusercontent.com';

/**
 * Synthesize the OIDC stack.
 * @returns {Template} Synthesized template.
 */
function synth() {
  return Template.fromStack(new GithubOidcStack(new App(), 'Oidc', { githubRepo: REPO }));
}

describe('allowedSubjects', () => {
  it('lists main and both platform environments for the repo', () => {
    expect(allowedSubjects(REPO)).toEqual([
      'repo:acme/ai-sdlc-platform:ref:refs/heads/main',
      'repo:acme/ai-sdlc-platform:environment:platform-dev',
      'repo:acme/ai-sdlc-platform:environment:platform-prod',
    ]);
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
                  [`${HOST}:sub`]: allowedSubjects(REPO),
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
