// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withReadSnapshot, withTransaction } from '../../src/db/index.js';
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

describe('withReadSnapshot', () => {
  it('sees one snapshot: a commit made meanwhile is not visible inside it', async () => {
    const other = db.newPool();

    const seen = await withReadSnapshot(db.pool, async (tx) => {
      const before = await tx.query('SELECT count(*)::int AS n FROM t');
      await other.query('INSERT INTO t VALUES (100)');
      const after = await tx.query('SELECT count(*)::int AS n FROM t');
      return [before.rows[0].n, after.rows[0].n];
    });

    expect(seen[0]).toBe(seen[1]);
    expect(await values()).toContain(100);
  });

  it('refuses writes', async () => {
    await expect(
      withReadSnapshot(db.pool, (tx) => tx.query('INSERT INTO t VALUES (101)')),
    ).rejects.toThrow(/read-only/);
    expect(await values()).not.toContain(101);
  });
});
