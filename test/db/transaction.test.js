// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../../src/db/index.js';
import { createTestDatabase } from './test-database.js';

/** @type {import('./test-database.js').TestDatabase} */
let db;

beforeAll(async () => {
  db = await createTestDatabase({ migrated: false });
  await db.pool.query('CREATE TABLE t (v int)');
});

afterAll(async () => {
  await db.close();
});

/**
 * Values in table t.
 * @returns {Promise<number[]>} Values.
 */
async function values() {
  const { rows } = await db.pool.query('SELECT v FROM t ORDER BY v');
  return rows.map((row) => row.v);
}

describe('withTransaction', () => {
  it('commits and returns the callback result', async () => {
    const result = await withTransaction(db.pool, async (tx) => {
      await tx.query('INSERT INTO t VALUES (1)');
      return 'done';
    });

    expect(result).toBe('done');
    expect(await values()).toContain(1);
  });

  it('rolls back and rethrows when the callback throws', async () => {
    const failure = new Error('stop');

    await expect(
      withTransaction(db.pool, async (tx) => {
        await tx.query('INSERT INTO t VALUES (2)');
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await values()).not.toContain(2);
  });

  it('returns the connection to the pool either way', async () => {
    await withTransaction(db.pool, async () => undefined).catch(() => undefined);
    await withTransaction(db.pool, async () => {
      throw new Error('x');
    }).catch(() => undefined);

    expect(db.pool.totalCount).toBe(db.pool.idleCount);
  });
});
