// @ts-check
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidPackageError, StalePackageError } from '../../src/errors/index.js';
import { assertCurrentPackage, contentHash, packageHash } from '../../src/workflow/index.js';

/**
 * Reference SHA-256 hex, computed independently of the code under test.
 * @param {string} text Input.
 * @returns {string} Hex digest.
 */
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const HASH_A = sha256('a');
const HASH_B = sha256('b');
const HASH_C = sha256('c');

describe('contentHash', () => {
  it('returns the SHA-256 hex of the text', () => {
    expect(contentHash('hello\n')).toBe(sha256('hello\n'));
  });

  it('hashes CRLF and LF line endings the same', () => {
    expect(contentHash('line one\r\nline two\r\n')).toBe(contentHash('line one\nline two\n'));
  });

  it('distinguishes different content', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });

  it('leaves a lone carriage return as content', () => {
    expect(contentHash('a\rb')).not.toBe(contentHash('a\nb'));
  });
});

describe('packageHash', () => {
  it('hashes the sorted version hashes joined with newlines', () => {
    expect(packageHash([HASH_B, HASH_A])).toBe(sha256([HASH_A, HASH_B].sort().join('\n')));
  });

  it('ignores the order of the version hashes', () => {
    expect(packageHash([HASH_C, HASH_A, HASH_B])).toBe(packageHash([HASH_A, HASH_B, HASH_C]));
  });

  it('changes when a version changes', () => {
    expect(packageHash([HASH_A, HASH_B])).not.toBe(packageHash([HASH_A, HASH_C]));
  });

  it('does not reorder the caller’s array', () => {
    const hashes = [HASH_B, HASH_A];

    packageHash(hashes);

    expect(hashes).toEqual([HASH_B, HASH_A]);
  });

  it('throws InvalidPackageError for an empty list', () => {
    expect(() => packageHash([])).toThrow(InvalidPackageError);
  });

  it.each([
    ['uppercase hex', HASH_A.toUpperCase()],
    ['too short', HASH_A.slice(1)],
    ['too long', `${HASH_A}0`],
    ['non-hex characters', `${HASH_A.slice(1)}g`],
    ['empty string', ''],
  ])('throws InvalidPackageError for a hash that is %s', (_name, bad) => {
    expect(() => packageHash([HASH_A, bad])).toThrow(InvalidPackageError);
  });
});

describe('assertCurrentPackage', () => {
  it('accepts a decision made on the current package', () => {
    expect(() => assertCurrentPackage(HASH_A, HASH_A)).not.toThrow();
  });

  it('refuses a decision whose package hash is stale', () => {
    expect(() => assertCurrentPackage(HASH_A, HASH_B)).toThrow(StalePackageError);
  });

  it('reports the stale decision as HTTP 409', () => {
    /** @type {unknown} */
    let caught;
    try {
      assertCurrentPackage(HASH_A, HASH_B);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ statusCode: 409, code: 'STALE_PACKAGE' });
  });
});
