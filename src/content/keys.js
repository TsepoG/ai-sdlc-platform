// @ts-check
import { ContentIntegrityError, NotFoundError } from '../errors/index.js';
import { contentHash } from '../workflow/index.js';

/** Key prefix naming the hash algorithm, so keys stay valid if the algorithm ever changes. */
const KEY_PREFIX = 'sha256/';
/** A content key: the prefix and a SHA-256 hex digest, nothing else (no path traversal). */
const KEY_PATTERN = /^sha256\/[0-9a-f]{64}$/;
const CRLF = /\r\n/g;

/**
 * @typedef {object} PreparedContent
 * @property {string} text Content to store, with line endings normalised to LF.
 * @property {string} hash SHA-256 hex of `text`.
 * @property {string} key Content-addressed key, `sha256/<hash>`.
 */

/**
 * Normalise content and derive its hash and key. Stored bytes are always the hashed bytes.
 * @param {string} content Raw content.
 * @returns {PreparedContent} What to store, and where.
 */
export function prepareContent(content) {
  const text = content.replace(CRLF, '\n');
  const hash = contentHash(text);
  return { text, hash, key: `${KEY_PREFIX}${hash}` };
}

/**
 * Refuse anything that is not a well-formed content key.
 * @param {string} key Key to check.
 * @returns {void}
 * @throws {NotFoundError} When the key is malformed; no content can exist under it.
 */
export function assertContentKey(key) {
  if (!KEY_PATTERN.test(key)) {
    throw new NotFoundError('No content exists under that key');
  }
}

/**
 * Check content read back from a store still matches its key.
 * @param {string} key Key it was read from.
 * @param {string} text Content read.
 * @returns {string} The content, unchanged.
 * @throws {ContentIntegrityError} When the content no longer hashes to its key.
 */
export function verifyContent(key, text) {
  if (`${KEY_PREFIX}${contentHash(text)}` !== key) {
    throw new ContentIntegrityError(`Stored content does not match its key ${key}`);
  }
  return text;
}
