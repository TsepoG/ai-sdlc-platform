// @ts-check
import { z } from 'zod';

/** Allowed NODE_ENV values. */
export const NODE_ENVS = /** @type {const} */ (['development', 'test', 'production']);
/** Allowed PLATFORM_ENV values. */
export const PLATFORM_ENVS = /** @type {const} */ ([
  'local',
  'test',
  'platform-dev',
  'platform-prod',
]);
/** Platform environments where the workflow API and dev auth may be switched on. */
export const UNDEPLOYED_PLATFORM_ENVS = /** @type {const} */ (['local', 'test']);
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
/** Where artifact content is stored. */
export const CONTENT_STORE_TYPES = /** @type {const} */ (['local', 's3']);
/** How API callers are identified: no identity yet, or a dev-only header pair. */
export const AUTH_MODES = /** @type {const} */ (['none', 'dev-headers']);

const DEFAULT_PORT = 8080;
const DEFAULT_DATABASE_PORT = 5432;
const DEFAULT_POOL_MAX = 10;
/** Stage configuration directory, relative to the working directory (the repo root or /app). */
const DEFAULT_STAGES_DIR = 'config/stages';
const DEFAULT_CONTENT_DIR = 'data/content';
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_BACKOFF_BASE_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 300_000;
const MIN_PORT = 1;
const MAX_PORT = 65535;

const port = z.coerce.number().int().min(MIN_PORT).max(MAX_PORT);
const positiveInt = z.coerce.number().int().positive();
/** Only the exact strings `true` and `false`, so a typo never silently means "off". */
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

const baseSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS),
  PORT: port.default(DEFAULT_PORT),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  APP_VERSION: z.string().min(1),
  PLATFORM_ENV: z.enum(PLATFORM_ENVS),
  STAGES_DIR: z.string().min(1).default(DEFAULT_STAGES_DIR),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: port.default(DEFAULT_DATABASE_PORT),
  DATABASE_NAME: z.string().min(1),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  DATABASE_SSL: booleanFlag.default(true),
  DATABASE_POOL_MAX: positiveInt.default(DEFAULT_POOL_MAX),
  CONTENT_STORE: z.enum(CONTENT_STORE_TYPES).default('local'),
  CONTENT_DIR: z.string().min(1).default(DEFAULT_CONTENT_DIR),
  CONTENT_BUCKET: z.string().min(1).optional(),
  WORKFLOW_API_ENABLED: booleanFlag.default(false),
  AUTH_MODE: z.enum(AUTH_MODES).default('none'),
  WORKER_ENABLED: booleanFlag.default(true),
  WORKER_POLL_INTERVAL_MS: positiveInt.default(DEFAULT_POLL_INTERVAL_MS),
  WORKER_BACKOFF_BASE_MS: positiveInt.default(DEFAULT_BACKOFF_BASE_MS),
  WORKER_MAX_ATTEMPTS: positiveInt.default(DEFAULT_MAX_ATTEMPTS),
  WORKER_LEASE_MS: positiveInt.default(DEFAULT_LEASE_MS),
});

/**
 * Rules that span variables. The workflow API and dev auth have no SSO behind them, so they are
 * refused anywhere the service is deployed (the dev load balancer is public).
 * @param {z.infer<typeof baseSchema>} env Parsed environment.
 * @param {z.core.$RefinementCtx} ctx Zod refinement context.
 * @returns {void}
 */
function checkCombinations(env, ctx) {
  const undeployed = /** @type {readonly string[]} */ (UNDEPLOYED_PLATFORM_ENVS).includes(
    env.PLATFORM_ENV,
  );
  if (env.WORKFLOW_API_ENABLED && !undeployed) {
    ctx.addIssue({
      code: 'custom',
      path: ['WORKFLOW_API_ENABLED'],
      message: 'can be true only when PLATFORM_ENV is local or test',
    });
  }
  if (env.AUTH_MODE === 'dev-headers' && !undeployed) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_MODE'],
      message: 'dev-headers is allowed only when PLATFORM_ENV is local or test',
    });
  }
  if (env.CONTENT_STORE === 's3' && env.CONTENT_BUCKET === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['CONTENT_BUCKET'],
      message: 'is required when CONTENT_STORE is s3',
    });
  }
}

/** Zod schema for the process environment variables the platform reads. */
export const envSchema = baseSchema.superRefine(checkCombinations);
