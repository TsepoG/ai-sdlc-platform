// @ts-check
import { UnauthenticatedError } from '../errors/index.js';

/** Dev-only user ID header; accepted only when AUTH_MODE is dev-headers (local or test). */
export const DEV_USER_HEADER = 'x-dev-user-id';
/** Dev-only roles header (comma-separated); same condition as the user header. */
export const DEV_ROLES_HEADER = 'x-dev-user-roles';

const SAFE_USER_ID = /^[\w.@-]{1,128}$/;
const ROLE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * @typedef {object} Identity
 * @property {import('../initiatives/index.js').Actor} actor The caller.
 * @property {string[]} roles Their roles.
 */

/**
 * Work out who is calling. Phase 04 replaces this with SSO; until then the only identity is a
 * dev header pair, which config refuses to enable in any deployed environment.
 * @param {{ headers: Record<string, string | string[] | undefined> }} request Incoming request.
 * @param {'none' | 'dev-headers'} authMode Configured auth mode.
 * @returns {Identity} The caller and their roles.
 * @throws {UnauthenticatedError} When there is no usable identity.
 */
export function resolveIdentity(request, authMode) {
  if (authMode !== 'dev-headers') {
    throw new UnauthenticatedError('No identity provider is configured');
  }
  const userId = request.headers[DEV_USER_HEADER];
  if (typeof userId !== 'string' || !SAFE_USER_ID.test(userId)) {
    throw new UnauthenticatedError(`A valid ${DEV_USER_HEADER} header is required`);
  }
  const rolesHeader = request.headers[DEV_ROLES_HEADER];
  const roles = (typeof rolesHeader === 'string' ? rolesHeader : '')
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role !== '');
  if (!roles.every((role) => ROLE.test(role))) {
    throw new UnauthenticatedError(`${DEV_ROLES_HEADER} must be a comma-separated list of roles`);
  }
  return { actor: { type: 'user', id: userId }, roles };
}
