// @ts-check
import { describe, expect, it } from 'vitest';
import { AppError, ConfigError } from '../../src/errors/index.js';

describe('AppError', () => {
  it('defaults to a 500 with a generic code', () => {
    const error = new AppError('boom');

    expect(error).toMatchObject({ name: 'AppError', message: 'boom', statusCode: 500 });
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.cause).toBeUndefined();
  });

  it('keeps a custom status code, code and cause', () => {
    const cause = new Error('root');

    const error = new AppError('nope', { statusCode: 409, code: 'STALE', cause });

    expect(error).toMatchObject({ statusCode: 409, code: 'STALE' });
    expect(error.cause).toBe(cause);
  });
});

describe('ConfigError', () => {
  it('is an AppError named ConfigError with its own code', () => {
    const cause = new Error('zod said no');

    const error = new ConfigError('bad env', { cause });

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ name: 'ConfigError', code: 'CONFIG_INVALID', statusCode: 500 });
    expect(error.cause).toBe(cause);
  });

  it('can be created without a cause', () => {
    expect(new ConfigError('bad env').cause).toBeUndefined();
  });
});
