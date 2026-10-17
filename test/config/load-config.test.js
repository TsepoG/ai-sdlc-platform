// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { ConfigError } from '../../src/errors/index.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'debug',
  APP_VERSION: 'abc123',
  PLATFORM_ENV: 'local',
};

describe('loadConfig', () => {
  it('returns typed configuration for a valid environment', () => {
    const config = loadConfig(validEnv);

    expect(config).toEqual({
      nodeEnv: 'test',
      port: 3000,
      logLevel: 'debug',
      appVersion: 'abc123',
      platformEnv: 'local',
    });
  });

  it('applies defaults for PORT and LOG_LEVEL', () => {
    const { NODE_ENV, APP_VERSION, PLATFORM_ENV } = validEnv;

    const config = loadConfig({ NODE_ENV, APP_VERSION, PLATFORM_ENV });

    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe('info');
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig(validEnv))).toBe(true);
  });

  it.each(['NODE_ENV', 'APP_VERSION', 'PLATFORM_ENV'])(
    'throws ConfigError naming %s when it is missing',
    (key) => {
      const env = { ...validEnv, [key]: undefined };

      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(key);
    },
  );

  it.each([
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', '80.5'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'loud'],
    ['PLATFORM_ENV', 'prod'],
    ['APP_VERSION', ''],
  ])('throws ConfigError for invalid %s=%s', (key, value) => {
    expect(() => loadConfig({ ...validEnv, [key]: value })).toThrow(ConfigError);
  });

  it('attaches the validation failure as cause and does not echo values', () => {
    /** @type {unknown} */
    let caught;
    try {
      loadConfig({ ...validEnv, PORT: 'super-secret-value' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const configError = /** @type {ConfigError} */ (caught);
    expect(configError.cause).toBeDefined();
    expect(configError.message).toContain('PORT');
    expect(configError.message).not.toContain('super-secret-value');
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
