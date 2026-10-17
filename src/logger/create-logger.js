// @ts-check
import { pino } from 'pino';

const SERVICE_NAME = 'ai-sdlc-platform';

/** Header paths that must never reach the logs. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

/**
 * @typedef {object} LoggerOptions
 * @property {string} level Minimum level to emit.
 * @property {string} version Application version added to every line.
 * @property {string} env Platform environment added to every line.
 * @property {{ write: (chunk: string) => void }} [destination] Output stream (defaults to stdout).
 */

/**
 * Create the structured JSON logger. Per-request loggers add `requestId` via `child`.
 * @param {LoggerOptions} options Logger settings.
 * @returns {import('pino').Logger} Configured pino logger.
 */
export function createLogger({ level, version, env, destination }) {
  return pino(
    {
      level,
      base: { service: SERVICE_NAME, version, env },
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACTED_PATHS, censor: '[Redacted]' },
    },
    destination,
  );
}
