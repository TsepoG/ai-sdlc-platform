// @ts-check
import { z } from 'zod';

/** Allowed NODE_ENV values. */
export const NODE_ENVS = /** @type {const} */ (['development', 'test', 'production']);
/** Allowed PLATFORM_ENV values. */
export const PLATFORM_ENVS = /** @type {const} */ (['local', 'platform-dev', 'platform-prod']);
/** Allowed LOG_LEVEL values (pino levels plus silent). */
export const LOG_LEVELS = /** @type {const} */ ([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

const DEFAULT_PORT = 8080;
/** Stage configuration directory, relative to the working directory (the repo root or /app). */
const DEFAULT_STAGES_DIR = 'config/stages';
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Zod schema for the process environment variables the platform reads. */
export const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS),
  PORT: z.coerce.number().int().min(MIN_PORT).max(MAX_PORT).default(DEFAULT_PORT),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  APP_VERSION: z.string().min(1),
  PLATFORM_ENV: z.enum(PLATFORM_ENVS),
  STAGES_DIR: z.string().min(1).default(DEFAULT_STAGES_DIR),
});
