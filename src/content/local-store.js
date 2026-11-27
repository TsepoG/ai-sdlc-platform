// @ts-check
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NotFoundError } from '../errors/index.js';
import { assertContentKey, prepareContent, verifyContent } from './keys.js';

/** @import { ContentStore } from './types.js' */

/**
 * Create a content store on the local filesystem, for local runs and tests.
 * @param {{ dir: string }} options Root directory for stored content.
 * @returns {ContentStore} The store.
 */
export function createLocalContentStore({ dir }) {
  return {
    kind: 'local',
    async put(content) {
      const { text, hash, key } = prepareContent(content);
      const path = join(dir, key);
      await mkdir(dirname(path), { recursive: true });
      // Write then rename, so a crash never leaves a partial file under a valid key. Renaming
      // over an existing file is harmless: same key means same bytes.
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, text, 'utf8');
      await rename(temporary, path);
      return { key, hash };
    },
    async get(key) {
      assertContentKey(key);
      try {
        return verifyContent(key, await readFile(join(dir, key), 'utf8'));
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
          throw new NotFoundError('No content exists under that key', { cause: error });
        }
        throw error;
      }
    },
  };
}
