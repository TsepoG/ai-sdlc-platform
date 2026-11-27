// @ts-check
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentIntegrityError, NotFoundError } from '../../src/errors/index.js';
import { createLocalContentStore } from '../../src/content/index.js';
import { contentHash } from '../../src/workflow/index.js';

/** @type {string} */
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'content-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createLocalContentStore', () => {
  it('stores content under a content-addressed key and returns its hash', async () => {
    const store = createLocalContentStore({ dir });

    const result = await store.put('# Brief\n');

    expect(result).toEqual({
      key: `sha256/${contentHash('# Brief\n')}`,
      hash: contentHash('# Brief\n'),
    });
    expect(await readFile(join(dir, result.key), 'utf8')).toBe('# Brief\n');
  });

  it('reads back what it stored', async () => {
    const store = createLocalContentStore({ dir });
    const { key } = await store.put('hello');

    expect(await store.get(key)).toBe('hello');
  });

  it('treats storing the same content twice as a no-op', async () => {
    const store = createLocalContentStore({ dir });

    const first = await store.put('same');
    const second = await store.put('same');

    expect(second).toEqual(first);
    expect(await store.get(first.key)).toBe('same');
  });

  it('stores line endings normalised to LF, matching the hash', async () => {
    const store = createLocalContentStore({ dir });

    const { key, hash } = await store.put('a\r\nb\r\n');

    expect(await store.get(key)).toBe('a\nb\n');
    expect(hash).toBe(contentHash('a\nb\n'));
  });

  it('throws NotFoundError for a key that was never stored', async () => {
    const store = createLocalContentStore({ dir });

    await expect(store.get(`sha256/${'0'.repeat(64)}`)).rejects.toThrow(NotFoundError);
  });

  it.each(['../etc/passwd', 'sha256/../../x', 'sha256/ABC', 'md5/abc'])(
    'refuses the malformed key %j',
    async (key) => {
      const store = createLocalContentStore({ dir });

      await expect(store.get(key)).rejects.toThrow(NotFoundError);
    },
  );

  it('throws ContentIntegrityError when stored bytes no longer match the key', async () => {
    const store = createLocalContentStore({ dir });
    const { key } = await store.put('original');
    await writeFile(join(dir, key), 'tampered');

    await expect(store.get(key)).rejects.toThrow(ContentIntegrityError);
  });

  it('rethrows unexpected read errors', async () => {
    const store = createLocalContentStore({ dir });
    const key = `sha256/${'1'.repeat(64)}`;
    await mkdir(join(dir, key), { recursive: true });

    await expect(store.get(key)).rejects.toThrow(/EISDIR/);
  });
});
