// @ts-check
import { createHash } from 'node:crypto';
import { InvalidPackageError, StalePackageError } from '../errors/index.js';

const HASH_ALGORITHM = 'sha256';
const SHA256_HEX = /^[0-9a-f]{64}$/;
const CRLF = /\r\n/g;
const LF = '\n';

/**
 * Order strings by UTF-16 code unit, independent of locale (the order a bare `sort()` uses).
 * @param {string} a First string.
 * @param {string} b Second string.
 * @returns {number} Negative, zero or positive, as `Array.prototype.sort` expects.
 */
function byCodeUnit(a, b) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * SHA-256 hex digest of a UTF-8 string.
 * @param {string} text Input.
 * @returns {string} 64 lowercase hex characters.
 */
function sha256Hex(text) {
  return createHash(HASH_ALGORITHM).update(text, 'utf8').digest('hex');
}

/**
 * Hash a version's content so the same text always hashes the same, whatever its line endings.
 * @param {string} text Version content.
 * @returns {string} SHA-256 hex of the text with `\r\n` normalised to `\n`.
 */
export function contentHash(text) {
  return sha256Hex(text.replace(CRLF, LF));
}

/**
 * Hash a review package from its versions' content hashes; the order of versions does not matter.
 * @param {ReadonlyArray<string>} versionHashes Content hashes of the versions in the package.
 * @returns {string} SHA-256 hex over the hashes, sorted and joined with `\n`.
 * @throws {InvalidPackageError} When the list is empty or a hash is not 64 lowercase hex characters.
 */
export function packageHash(versionHashes) {
  if (versionHashes.length === 0) {
    throw new InvalidPackageError('A review package needs at least one version');
  }
  const malformed = versionHashes.findIndex((hash) => !SHA256_HEX.test(hash));
  if (malformed !== -1) {
    throw new InvalidPackageError(
      `Version hash at index ${malformed} is not a SHA-256 hex digest (64 lowercase hex characters)`,
    );
  }
  return sha256Hex([...versionHashes].sort(byCodeUnit).join(LF));
}

/**
 * Refuse a decision made on a package other than the current one.
 * @param {string} currentHash Hash of the package as it is now.
 * @param {string} decisionHash Hash of the package the reviewer saw.
 * @returns {void}
 * @throws {StalePackageError} When the hashes differ (HTTP 409).
 */
export function assertCurrentPackage(currentHash, decisionHash) {
  if (currentHash !== decisionHash) {
    throw new StalePackageError(
      'The package changed after you reviewed it; review the current version and decide again',
    );
  }
}
