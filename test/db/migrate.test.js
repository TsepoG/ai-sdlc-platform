// @ts-check
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationError } from '../../src/errors/index.js';
import { migrate } from '../../src/db/index.js';
import { createTestDatabase } from './test-database.js';

/** @type {import('./test-database.js').TestDatabase} */
let db;
/** @type {string} */
let dir;

beforeEach(async () => {
  db = await createTestDatabase({ migrated: false });
  dir = await mkdtemp(join(tmpdir(), 'migrations-'));
});

afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

/**
 * Table names in the test schema.
 * @returns {Promise<string[]>} Sorted table names.
 */
async function tables() {
  const { rows } = await db.pool.query(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1',
    [db.schema],
  );
  return rows.map((row) => row.table_name);
}

describe('migrate', () => {
  it('applies the real migrations to a fresh database', async () => {
    const result = await migrate(db.pool);

    expect(result.applied).toContain('0001_initial_schema');
    expect(await tables()).toEqual(
      expect.arrayContaining(['initiatives', 'audit_events', 'jobs', 'schema_migrations']),
    );
  });

  it('is a no-op the second time', async () => {
    await migrate(db.pool);

    const second = await migrate(db.pool);

    expect(second.applied).toEqual([]);
  });

  it('applies each migration once when two runners start together', async () => {
    const [first, second] = await Promise.all([migrate(db.pool), migrate(db.newPool())]);

    expect(
      [...first.applied, ...second.applied].filter((v) => v === '0001_initial_schema'),
    ).toHaveLength(1);
    const { rows } = await db.pool.query('SELECT version FROM schema_migrations');
    expect(rows).toHaveLength(1);
  });

  it('applies files in numeric order and records each', async () => {
    await writeFile(join(dir, '0002_second.sql'), 'CREATE TABLE b (id int REFERENCES a (id));');
    await writeFile(join(dir, '0001_first.sql'), 'CREATE TABLE a (id int PRIMARY KEY);');
    await writeFile(join(dir, 'README.md'), 'not a migration');

    const result = await migrate(db.pool, { dir });

    expect(result.applied).toEqual(['0001_first', '0002_second']);
  });

  it('refuses a migration that changed after it was applied', async () => {
    await writeFile(join(dir, '0001_first.sql'), 'CREATE TABLE a (id int);');
    await migrate(db.pool, { dir });
    await writeFile(join(dir, '0001_first.sql'), 'CREATE TABLE a (id bigint);');

    await expect(migrate(db.pool, { dir })).rejects.toThrow(/0001_first.*changed/);
  });

  it('rolls back a failing migration and names it', async () => {
    await writeFile(join(dir, '0001_first.sql'), 'CREATE TABLE a (id int); SELECT broken(;');

    await expect(migrate(db.pool, { dir })).rejects.toThrow(MigrationError);
    await expect(migrate(db.pool, { dir })).rejects.toThrow(/0001_first/);
    expect(await tables()).not.toContain('a');
  });

  it.each(['1_short.sql', '0001-dash.sql', '0001_Upper.sql'])(
    'refuses the badly named file %s',
    async (name) => {
      await writeFile(join(dir, name), 'SELECT 1;');

      await expect(migrate(db.pool, { dir })).rejects.toThrow(MigrationError);
    },
  );

  it('refuses two files with the same number', async () => {
    await writeFile(join(dir, '0001_a.sql'), 'SELECT 1;');
    await writeFile(join(dir, '0001_b.sql'), 'SELECT 1;');

    await expect(migrate(db.pool, { dir })).rejects.toThrow(/0001/);
  });

  it('logs each applied migration', async () => {
    await writeFile(join(dir, '0001_first.sql'), 'SELECT 1;');
    /** @type {unknown[]} */
    const logged = [];
    const logger = { info: (/** @type {unknown[]} */ ...args) => void logged.push(args) };

    await migrate(db.pool, { dir, logger });

    expect(logged).toEqual([[{ version: '0001_first' }, 'migration applied']]);
  });
});
