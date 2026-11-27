// @ts-check
// Each test file gets its own PostgreSQL schema, so files running in parallel never share
// tables. Vitest exposes environment variables on import.meta.env, which keeps tests off
// process.env (only src/config may read it).
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/index.js';

const SCHEMA_PREFIX = 't_';
const POOL_SIZE = 5;

/**
 * The test database URL, or a clear error saying how to provide one.
 * @returns {string} Connection string.
 * @throws {Error} When TEST_DATABASE_URL is not set.
 */
export function testDatabaseUrl() {
  const env = /** @type {{ env?: Record<string, string | undefined> }} */ (
    /** @type {unknown} */ (import.meta)
  ).env;
  const url = env?.TEST_DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'TEST_DATABASE_URL is not set. Start PostgreSQL (docker compose up -d) and set it, ' +
        'e.g. postgres://platform:change-me-local-only@localhost:5432/platform; see README.',
    );
  }
  return url;
}

/**
 * DDL can't take bind parameters, so the generated schema name is quoted as an identifier.
 * @param {string} schema Schema name.
 * @returns {string} The CREATE SCHEMA statement.
 */
function createSchemaStatement(schema) {
  return 'CREATE SCHEMA '.concat(pg.escapeIdentifier(schema));
}

/**
 * Statement that drops a test schema and everything in it.
 * @param {string} schema Schema name.
 * @returns {string} The DROP SCHEMA statement.
 */
function dropSchemaStatement(schema) {
  return 'DROP SCHEMA '.concat(pg.escapeIdentifier(schema), ' CASCADE');
}

/**
 * @typedef {object} TestDatabase
 * @property {pg.Pool} pool Pool whose connections use the test schema.
 * @property {string} schema Schema name.
 * @property {() => pg.Pool} newPool Another pool on the same schema (for concurrency tests).
 * @property {() => Promise<void>} close Drop the schema and end every pool.
 */

/**
 * Create an isolated schema and a pool bound to it.
 * @param {{ migrated?: boolean }} [options] Whether to apply the real migrations (default true).
 * @returns {Promise<TestDatabase>} The test database.
 */
export async function createTestDatabase({ migrated = true } = {}) {
  const url = testDatabaseUrl();
  const schema = `${SCHEMA_PREFIX}${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(createSchemaStatement(schema));
  await admin.end();

  /** @type {pg.Pool[]} */
  const pools = [];
  const newPool = () => {
    const created = new pg.Pool({
      connectionString: url,
      max: POOL_SIZE,
      options: `-c search_path=${schema}`,
    });
    pools.push(created);
    return created;
  };
  const pool = newPool();
  if (migrated) {
    await migrate(pool);
  }
  return {
    pool,
    schema,
    newPool,
    async close() {
      await Promise.all(pools.map((each) => each.end()));
      const cleanup = new pg.Client({ connectionString: url });
      await cleanup.connect();
      await cleanup.query(dropSchemaStatement(schema));
      await cleanup.end();
    },
  };
}
