// @ts-check
import { ConfigError } from '../errors/index.js';
import { envSchema } from './schema.js';

/**
 * @typedef {object} DatabaseConfig
 * @property {string} host Database host.
 * @property {number} port Database port.
 * @property {string} name Database name.
 * @property {string} user Database user.
 * @property {string} password Database password; never log it.
 * @property {boolean} ssl Whether to use TLS; when on, the server certificate is always verified.
 * @property {number} poolMax Maximum pooled connections.
 */

/**
 * @typedef {object} ContentConfig
 * @property {'local' | 's3'} type Which content store to use.
 * @property {string} dir Directory for the local store.
 * @property {string | undefined} bucket S3 bucket for the s3 store.
 */

/**
 * @typedef {object} WorkerConfig
 * @property {boolean} enabled Whether this process runs the job worker.
 * @property {number} pollIntervalMs Pause between polls when no job is ready.
 * @property {number} backoffBaseMs First retry delay; doubles on each attempt.
 * @property {number} maxAttempts Attempts before a job is marked failed.
 * @property {number} leaseMs How long a claimed job may run before another worker may reclaim it.
 */

/**
 * @typedef {object} Config
 * @property {'development' | 'test' | 'production'} nodeEnv Runtime mode.
 * @property {number} port HTTP listen port.
 * @property {'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'} logLevel Minimum log level.
 * @property {string} appVersion Version reported by /health.
 * @property {'local' | 'test' | 'platform-dev' | 'platform-prod'} platformEnv Platform environment this process runs in.
 * @property {string} stagesDir Directory holding the stage configuration files.
 * @property {DatabaseConfig} database PostgreSQL connection settings.
 * @property {ContentConfig} content Artifact content store settings.
 * @property {boolean} workflowApiEnabled Whether the workflow routes are registered (local/test only).
 * @property {'none' | 'dev-headers'} authMode How callers are identified (dev headers local/test only).
 * @property {WorkerConfig} worker Background job worker settings.
 */

/**
 * Validate the environment and return typed, frozen configuration. This is the only code
 * allowed to read `process.env`.
 * @param {Record<string, string | undefined>} [source] Environment to read (defaults to process.env).
 * @returns {Readonly<Config>} Validated configuration.
 * @throws {ConfigError} When any variable is missing or invalid; names the fields, never the values.
 */
export function loadConfig(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid environment configuration: ${problems}`, {
      cause: result.error,
    });
  }
  const env = result.data;
  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    appVersion: env.APP_VERSION,
    platformEnv: env.PLATFORM_ENV,
    stagesDir: env.STAGES_DIR,
    database: Object.freeze({
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      name: env.DATABASE_NAME,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      ssl: env.DATABASE_SSL,
      poolMax: env.DATABASE_POOL_MAX,
    }),
    content: Object.freeze({
      type: env.CONTENT_STORE,
      dir: env.CONTENT_DIR,
      bucket: env.CONTENT_BUCKET,
    }),
    workflowApiEnabled: env.WORKFLOW_API_ENABLED,
    authMode: env.AUTH_MODE,
    worker: Object.freeze({
      enabled: env.WORKER_ENABLED,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      backoffBaseMs: env.WORKER_BACKOFF_BASE_MS,
      maxAttempts: env.WORKER_MAX_ATTEMPTS,
      leaseMs: env.WORKER_LEASE_MS,
    }),
  });
}
