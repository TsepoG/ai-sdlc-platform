// @ts-check

/**
 * @typedef {object} StoredContent
 * @property {string} key Content-addressed key, `sha256/<hash>`.
 * @property {string} hash SHA-256 hex of the stored (LF-normalised) content.
 */

/**
 * @typedef {object} ContentStore
 * @property {'local' | 's3'} kind Which backend this is.
 * @property {(content: string) => Promise<StoredContent>} put Store content; storing the same
 *   content again is a no-op that returns the same key.
 * @property {(key: string) => Promise<string>} get Read content back, verified against its key.
 */

export {};
