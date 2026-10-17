// @ts-check
import { ConfigError } from '../errors/index.js';
import { envSchema } from './schema.js';

/**
 * @typedef {object} Config
 * @property {'development' | 'test' | 'production'} nodeEnv Runtime mode.
 * @property {number} port HTTP listen port.
 * @property {'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'} logLevel Minimum log level.
 * @property {string} appVersion Version reported by /health.
 * @property {'local' | 'platform-dev' | 'platform-prod'} platformEnv Platform environment this process runs in.
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
  });
}
