// @ts-check
import { describe, expect, it } from 'vitest';
import { createContentStore } from '../../src/content/index.js';

describe('createContentStore', () => {
  it('creates a local store for type local', () => {
    const store = createContentStore({ type: 'local', dir: 'data/content', bucket: undefined });

    expect(store.kind).toBe('local');
  });

  it('creates an S3 store for type s3', () => {
    const store = createContentStore({ type: 's3', dir: 'unused', bucket: 'artifacts' });

    expect(store.kind).toBe('s3');
  });

  it('uses an injected S3 client', () => {
    const client = { send: async () => ({}) };

    const store = createContentStore(
      { type: 's3', dir: 'unused', bucket: 'b' },
      { s3Client: client },
    );

    expect(store.kind).toBe('s3');
  });
});
