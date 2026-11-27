// @ts-check
import { describe, expect, it } from 'vitest';
import { UnauthenticatedError } from '../../src/errors/index.js';
import { resolveIdentity } from '../../src/server/dev-identity.js';

/**
 * A request with the given headers.
 * @param {Record<string, string | string[]>} headers Headers.
 * @returns {{ headers: Record<string, string | string[]> }} Request-like object.
 */
const request = (headers) => ({ headers });

describe('resolveIdentity', () => {
  it('reads the user and roles from the dev headers', () => {
    const identity = resolveIdentity(
      request({ 'x-dev-user-id': 'u-1', 'x-dev-user-roles': 'product-owner, tech-lead' }),
      'dev-headers',
    );

    expect(identity).toEqual({
      actor: { type: 'user', id: 'u-1' },
      roles: ['product-owner', 'tech-lead'],
    });
  });

  it('gives no roles when the roles header is absent', () => {
    expect(resolveIdentity(request({ 'x-dev-user-id': 'u-1' }), 'dev-headers').roles).toEqual([]);
  });

  it.each([
    ['no user header', {}],
    ['an empty user', { 'x-dev-user-id': '' }],
    ['an unsafe user', { 'x-dev-user-id': 'bad id' }],
    ['a repeated user header', { 'x-dev-user-id': ['a', 'b'] }],
    ['an unsafe role', { 'x-dev-user-id': 'u', 'x-dev-user-roles': 'Admin!' }],
  ])('refuses %s', (_name, headers) => {
    expect(() => resolveIdentity(request(headers), 'dev-headers')).toThrow(UnauthenticatedError);
  });

  it('refuses everyone when there is no auth mode', () => {
    expect(() => resolveIdentity(request({ 'x-dev-user-id': 'u-1' }), 'none')).toThrow(
      UnauthenticatedError,
    );
  });
});
