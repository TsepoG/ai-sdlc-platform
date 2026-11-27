// @ts-check
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MigrationError } from '../errors/index.js';

/** Migrations shipped with the service (the image copies this folder). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
/**
 * Advisory lock key held while migrating, so two tasks starting together can't both apply a
 * migration. Any fixed 64-bit number works; this one is used for nothing else.
 */
const MIGRATION_LOCK_KEY = 7_404_221_002;
const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const SQL_EXTENSION = '.sql';

/**
 * @typedef {object} MigrationFile
 * @property {string} version File name without `.sql`, e.g. `0001_initial_schema`.
 * @property {string} sql File contents.
 * @property {string} checksum SHA-256 hex of the contents.
 */

/**
 * Read and validate the migration files in a directory.
 * @param {string} dir Directory holding `NNNN_name.sql` files.
 * @returns {Promise<MigrationFile[]>} Migrations in order.
 * @throws {MigrationError} On a badly named file or a repeated number.
 */
async function readMigrations(dir) {
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(SQL_EXTENSION))
    .sort((a, b) => a.localeCompare(b));
  const numbers = new Set();
  /** @type {MigrationFile[]} */
  const migrations = [];
  for (const name of names) {
    const match = MIGRATION_FILE.exec(name);
    if (match === null) {
      throw new MigrationError(`Migration file "${name}" must be named NNNN_lowercase_name.sql`);
    }
    if (numbers.has(match[1])) {
      throw new MigrationError(`Two migration files share the number ${match[1]}`);
    }
    numbers.add(match[1]);
    const sql = await readFile(join(dir, name), 'utf8');
    const checksum = createHash('sha256').update(sql, 'utf8').digest('hex');
    migrations.push({ version: name.slice(0, -SQL_EXTENSION.length), sql, checksum });
  }
  return migrations;
}

/**
 * Apply one migration in its own transaction and record it.
 * @param {import('pg').PoolClient} client Connection holding the migration lock.
 * @param {MigrationFile} migration Migration to apply.
 * @returns {Promise<void>}
 * @throws {MigrationError} When the SQL fails; nothing from it is kept.
 */
async function applyMigration(client, migration) {
  try {
    await client.query('BEGIN');
    await client.query(migration.sql);
    await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
      migration.version,
      migration.checksum,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new MigrationError(`Migration ${migration.version} failed`, { cause: error });
  }
}

/**
 * Apply every pending migration, in order, under a PostgreSQL advisory lock.
 * @param {import('pg').Pool} pool Connection pool.
 * @param {{ dir?: string, logger?: { info: (...args: unknown[]) => void } }} [options] Migration
 *   directory (default: the shipped `migrations/`) and a logger.
 * @returns {Promise<{ applied: string[] }>} Versions applied by this call (empty when up to date).
 * @throws {MigrationError} On a bad file, a failed migration, or an applied migration whose
 *   file has changed since.
 */
export async function migrate(pool, { dir = MIGRATIONS_DIR, logger } = {}) {
  const migrations = await readMigrations(dir);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version text PRIMARY KEY,
         checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));
    /** @type {string[]} */
    const appliedNow = [];
    for (const migration of migrations) {
      const recorded = applied.get(migration.version);
      if (recorded !== undefined) {
        if (recorded !== migration.checksum) {
          throw new MigrationError(
            `Migration ${migration.version} changed after it was applied; add a new migration instead`,
          );
        }
        continue;
      }
      await applyMigration(client, migration);
      logger?.info({ version: migration.version }, 'migration applied');
      appliedNow.push(migration.version);
    }
    return { applied: appliedNow };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    client.release();
  }
}
