// @ts-check
import { S3Client } from '@aws-sdk/client-s3';
import { createLocalContentStore } from './local-store.js';
import { createS3ContentStore } from './s3-store.js';

export { createLocalContentStore } from './local-store.js';
export { createS3ContentStore } from './s3-store.js';
/** @typedef {import('./types.js').ContentStore} ContentStore */
/** @typedef {import('./types.js').StoredContent} StoredContent */
/** @typedef {import('./s3-store.js').S3Like} S3Like */

/**
 * Create the content store the configuration asks for.
 * @param {import('../config/index.js').ContentConfig} config Content store settings.
 * @param {{ s3Client?: import('./s3-store.js').S3Like }} [deps] S3 client to use (default: a new
 *   S3Client, which takes its region and credentials from the runtime, e.g. the ECS task role).
 * @returns {import('./types.js').ContentStore} The store.
 */
export function createContentStore(config, { s3Client } = {}) {
  if (config.type === 's3') {
    // Config validation guarantees a bucket when the type is s3.
    const bucket = /** @type {string} */ (config.bucket);
    return createS3ContentStore({ client: s3Client ?? new S3Client({}), bucket });
  }
  return createLocalContentStore({ dir: config.dir });
}
