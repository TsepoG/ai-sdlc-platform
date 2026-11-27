// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { ConfigError } from '../../src/errors/index.js';

/** Synthetic values only; the password is a test placeholder. */
const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'debug',
  APP_VERSION: 'abc123',
  PLATFORM_ENV: 'local',
  DATABASE_HOST: 'db.internal',
  DATABASE_PORT: '5433',
  DATABASE_NAME: 'platform',
  DATABASE_USER: 'platform_app',
  DATABASE_PASSWORD: 'test-password-placeholder',
};

/**
 * Load config and return the thrown ConfigError.
 * @param {Record<string, string | undefined>} env Environment to load.
 * @returns {ConfigError} The error.
 */
function configErrorFor(env) {
  /** @type {unknown} */
  let caught;
  try {
    loadConfig(env);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConfigError);
  return /** @type {ConfigError} */ (caught);
}

describe('loadConfig', () => {
  it('returns typed configuration for a valid environment', () => {
    const config = loadConfig(validEnv);

    expect(config).toEqual({
      nodeEnv: 'test',
      port: 3000,
      logLevel: 'debug',
      appVersion: 'abc123',
      platformEnv: 'local',
      stagesDir: 'config/stages',
      database: {
        host: 'db.internal',
        port: 5433,
        name: 'platform',
        user: 'platform_app',
        password: 'test-password-placeholder',
        ssl: true,
        poolMax: 10,
      },
      content: { type: 'local', dir: 'data/content', bucket: undefined },
      workflowApiEnabled: false,
      authMode: 'none',
      worker: {
        enabled: true,
        pollIntervalMs: 1000,
        backoffBaseMs: 5000,
        maxAttempts: 5,
        leaseMs: 300000,
      },
    });
  });

  it('applies defaults for PORT and LOG_LEVEL', () => {
    const config = loadConfig({ ...validEnv, PORT: undefined, LOG_LEVEL: undefined });

    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe('info');
  });

  it('defaults the database port to 5432', () => {
    expect(loadConfig({ ...validEnv, DATABASE_PORT: undefined }).database.port).toBe(5432);
  });

  it('reads the stages directory from STAGES_DIR', () => {
    expect(loadConfig({ ...validEnv, STAGES_DIR: '/srv/stages' }).stagesDir).toBe('/srv/stages');
  });

  it('returns a deeply frozen object', () => {
    const config = loadConfig(validEnv);

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
    expect(Object.isFrozen(config.worker)).toBe(true);
  });

  it.each([
    'NODE_ENV',
    'APP_VERSION',
    'PLATFORM_ENV',
    'DATABASE_HOST',
    'DATABASE_NAME',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
  ])('throws ConfigError naming %s when it is missing', (key) => {
    const env = { ...validEnv, [key]: undefined };

    expect(configErrorFor(env).message).toContain(key);
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', '80.5'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'loud'],
    ['PLATFORM_ENV', 'prod'],
    ['APP_VERSION', ''],
    ['STAGES_DIR', ''],
    ['DATABASE_PORT', 'x'],
    ['DATABASE_SSL', 'maybe'],
    ['DATABASE_POOL_MAX', '0'],
    ['CONTENT_STORE', 'ftp'],
    ['WORKFLOW_API_ENABLED', 'yes'],
    ['AUTH_MODE', 'basic'],
    ['WORKER_ENABLED', '1'],
    ['WORKER_POLL_INTERVAL_MS', '-1'],
    ['WORKER_MAX_ATTEMPTS', '0'],
  ])('throws ConfigError for invalid %s=%s', (key, value) => {
    expect(configErrorFor({ ...validEnv, [key]: value }).message).toContain(key);
  });

  it('never echoes a value, including the database password', () => {
    const error = configErrorFor({ ...validEnv, PORT: 'super-secret-value', DATABASE_HOST: '' });

    expect(error.cause).toBeDefined();
    expect(error.message).toContain('PORT');
    expect(error.message).not.toContain('super-secret-value');
    expect(error.message).not.toContain(validEnv.DATABASE_PASSWORD);
  });

  it('turns database TLS off only when DATABASE_SSL is false', () => {
    expect(loadConfig({ ...validEnv, DATABASE_SSL: 'false' }).database.ssl).toBe(false);
    expect(loadConfig({ ...validEnv, DATABASE_SSL: 'true' }).database.ssl).toBe(true);
  });

  describe('content store', () => {
    it('uses the S3 bucket when CONTENT_STORE is s3', () => {
      const config = loadConfig({ ...validEnv, CONTENT_STORE: 's3', CONTENT_BUCKET: 'artifacts' });

      expect(config.content).toEqual({ type: 's3', dir: 'data/content', bucket: 'artifacts' });
    });

    it('requires CONTENT_BUCKET when CONTENT_STORE is s3', () => {
      expect(configErrorFor({ ...validEnv, CONTENT_STORE: 's3' }).message).toContain(
        'CONTENT_BUCKET',
      );
    });

    it('reads the local directory from CONTENT_DIR', () => {
      expect(loadConfig({ ...validEnv, CONTENT_DIR: 'srv/content' }).content.dir).toBe(
        'srv/content',
      );
    });
  });

  describe('workflow API and dev auth', () => {
    it.each(['local', 'test'])('can be enabled when PLATFORM_ENV is %s', (platformEnv) => {
      const config = loadConfig({
        ...validEnv,
        PLATFORM_ENV: platformEnv,
        WORKFLOW_API_ENABLED: 'true',
        AUTH_MODE: 'dev-headers',
      });

      expect(config.workflowApiEnabled).toBe(true);
      expect(config.authMode).toBe('dev-headers');
    });

    it.each(['platform-dev', 'platform-prod'])(
      'refuses WORKFLOW_API_ENABLED in %s',
      (platformEnv) => {
        const error = configErrorFor({
          ...validEnv,
          PLATFORM_ENV: platformEnv,
          WORKFLOW_API_ENABLED: 'true',
        });

        expect(error.message).toContain('WORKFLOW_API_ENABLED');
      },
    );

    it.each(['platform-dev', 'platform-prod'])('refuses dev-headers auth in %s', (platformEnv) => {
      const error = configErrorFor({
        ...validEnv,
        PLATFORM_ENV: platformEnv,
        AUTH_MODE: 'dev-headers',
      });

      expect(error.message).toContain('AUTH_MODE');
    });

    it.each([
      ['WORKFLOW_API_ENABLED', { WORKFLOW_API_ENABLED: 'true' }],
      ['AUTH_MODE', { AUTH_MODE: 'dev-headers' }],
    ])('refuses %s when NODE_ENV is production, whatever PLATFORM_ENV says', (key, extra) => {
      const error = configErrorFor({
        ...validEnv,
        NODE_ENV: 'production',
        PLATFORM_ENV: 'test',
        ...extra,
      });

      expect(error.message).toContain(key);
    });

    it.each(['platform-dev', 'platform-prod'])(
      'refuses DATABASE_SSL=false in %s',
      (platformEnv) => {
        const error = configErrorFor({
          ...validEnv,
          PLATFORM_ENV: platformEnv,
          DATABASE_SSL: 'false',
        });

        expect(error.message).toContain('DATABASE_SSL');
      },
    );

    it('allows the defaults in a deployed environment', () => {
      expect(loadConfig({ ...validEnv, PLATFORM_ENV: 'platform-prod' }).workflowApiEnabled).toBe(
        false,
      );
    });
  });

  it('reads worker settings', () => {
    const config = loadConfig({
      ...validEnv,
      WORKER_ENABLED: 'false',
      WORKER_POLL_INTERVAL_MS: '50',
      WORKER_BACKOFF_BASE_MS: '10',
      WORKER_MAX_ATTEMPTS: '3',
      WORKER_LEASE_MS: '1000',
    });

    expect(config.worker).toEqual({
      enabled: false,
      pollIntervalMs: 50,
      backoffBaseMs: 10,
      maxAttempts: 3,
      leaseMs: 1000,
    });
  });

  it('reads the process environment when no source is given', () => {
    for (const [key, value] of Object.entries(validEnv)) {
      vi.stubEnv(key, value);
    }
    try {
      expect(loadConfig().appVersion).toBe('abc123');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
