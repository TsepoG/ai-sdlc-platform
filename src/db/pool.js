// @ts-check
import pg from 'pg';

const APPLICATION_NAME = 'ai-sdlc-platform';
/** Fail fast when the database is unreachable instead of hanging the request or the probe. */
const CONNECT_TIMEOUT_MS = 5000;

/**
 * @typedef {object} Queryable
 * @property {(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>} query Run a query.
 */

/**
 * Create the connection pool. When TLS is on, the server certificate is always verified
 * (`rejectUnauthorized: true`); the RDS CA comes from NODE_EXTRA_CA_CERTS in the image.
 * @param {import('../config/index.js').DatabaseConfig} settings Validated database settings.
 * @param {{ logger?: { error: (...args: unknown[]) => void } }} [deps] Logger for idle-client errors.
 * @returns {pg.Pool} The pool.
 */
export function createPool(settings, { logger } = {}) {
  const pool = new pg.Pool({
    host: settings.host,
    port: settings.port,
    database: settings.name,
    user: settings.user,
    password: settings.password,
    max: settings.poolMax,
    ssl: settings.ssl ? { rejectUnauthorized: true } : false,
    application_name: APPLICATION_NAME,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  // An idle client losing its connection emits 'error' on the pool; unhandled, it would crash
  // the process. Log it; the pool replaces the client.
  pool.on('error', (error) => logger?.error({ err: error }, 'idle database client failed'));
  return pool;
}

/**
 * Check the database answers a trivial query, for the readiness probe.
 * @param {Queryable} db Pool or client.
 * @returns {Promise<boolean>} True when the database answered.
 */
export async function pingDatabase(db) {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
