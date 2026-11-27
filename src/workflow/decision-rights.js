// @ts-check
import { NotAuthorisedError, SeparationOfDutiesError } from '../errors/index.js';

/**
 * @typedef {object} DecisionRightsInput
 * @property {string} reviewerId Person deciding.
 * @property {ReadonlyArray<string>} reviewerRoles Roles the reviewer holds.
 * @property {string} approverRole Role the gate requires.
 * @property {ReadonlyArray<string>} packageAuthorIds Everyone who authored or edited a version in the package.
 */

/**
 * @typedef {{ allowed: true } | { allowed: false, reason: 'missing_role' | 'author_of_package' }} DecisionRights
 */

/**
 * Decide whether a reviewer may decide a gate: they need the gate's role and must not have
 * authored or edited any version in the package (separation of duties).
 * @param {DecisionRightsInput} input Reviewer, gate role and package authors.
 * @returns {DecisionRights} Allowed, or the reason it is not.
 */
export function checkDecisionRights({ reviewerId, reviewerRoles, approverRole, packageAuthorIds }) {
  if (!reviewerRoles.includes(approverRole)) {
    return { allowed: false, reason: 'missing_role' };
  }
  if (packageAuthorIds.includes(reviewerId)) {
    return { allowed: false, reason: 'author_of_package' };
  }
  return { allowed: true };
}

/**
 * Throw unless the reviewer may decide the gate.
 * @param {DecisionRightsInput} input Reviewer, gate role and package authors.
 * @returns {void}
 * @throws {NotAuthorisedError} When the reviewer lacks the gate's role (HTTP 403).
 * @throws {SeparationOfDutiesError} When the reviewer authored or edited the package (HTTP 403).
 */
export function assertCanDecide(input) {
  const rights = checkDecisionRights(input);
  if (rights.allowed) {
    return;
  }
  if (rights.reason === 'missing_role') {
    throw new NotAuthorisedError(`Deciding this gate needs the "${input.approverRole}" role`);
  }
  throw new SeparationOfDutiesError(
    'You authored or edited a version in this package, so you cannot decide its gate',
  );
}
