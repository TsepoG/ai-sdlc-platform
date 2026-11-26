// @ts-check
import { describe, expect, it } from 'vitest';
import { NotAuthorisedError, SeparationOfDutiesError } from '../../src/errors/index.js';
import { assertCanDecide, checkDecisionRights } from '../../src/workflow/index.js';

const APPROVER_ROLE = 'product-owner';

/**
 * Decision-rights input with sensible defaults.
 * @param {Partial<import('../../src/workflow/index.js').DecisionRightsInput>} overrides Fields to replace.
 * @returns {import('../../src/workflow/index.js').DecisionRightsInput} Input.
 */
function request(overrides) {
  return {
    reviewerId: 'user-reviewer',
    reviewerRoles: [APPROVER_ROLE],
    approverRole: APPROVER_ROLE,
    packageAuthorIds: ['user-author', 'agent-brief'],
    ...overrides,
  };
}

describe('checkDecisionRights', () => {
  it('allows a non-author with the approver role', () => {
    expect(checkDecisionRights(request({}))).toEqual({ allowed: true });
  });

  it('refuses an author of the package even with the approver role', () => {
    expect(checkDecisionRights(request({ reviewerId: 'user-author' }))).toEqual({
      allowed: false,
      reason: 'author_of_package',
    });
  });

  it('refuses a non-author without the approver role', () => {
    expect(checkDecisionRights(request({ reviewerRoles: ['tech-lead'] }))).toEqual({
      allowed: false,
      reason: 'missing_role',
    });
  });

  it('reports a missing role first when the reviewer is also an author', () => {
    expect(checkDecisionRights(request({ reviewerId: 'user-author', reviewerRoles: [] }))).toEqual({
      allowed: false,
      reason: 'missing_role',
    });
  });
});

describe('assertCanDecide', () => {
  it('returns quietly for a non-author with the approver role', () => {
    expect(() => assertCanDecide(request({}))).not.toThrow();
  });

  it('throws SeparationOfDutiesError (403) for an author of the package', () => {
    expect(() => assertCanDecide(request({ reviewerId: 'user-author' }))).toThrow(
      SeparationOfDutiesError,
    );
  });

  it('throws NotAuthorisedError (403) for a reviewer without the role', () => {
    expect(() => assertCanDecide(request({ reviewerRoles: [] }))).toThrow(NotAuthorisedError);
  });
});
