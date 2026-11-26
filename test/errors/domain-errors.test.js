// @ts-check
import { describe, expect, it } from 'vitest';
import {
  AppError,
  InvalidPackageError,
  InvalidTransitionError,
  NotAuthorisedError,
  RoutingError,
  SeparationOfDutiesError,
  StageConfigError,
  StalePackageError,
} from '../../src/errors/index.js';

describe.each([
  ['RoutingError', RoutingError, 500, 'ROUTING_INVALID'],
  ['InvalidTransitionError', InvalidTransitionError, 409, 'INVALID_TRANSITION'],
  ['StalePackageError', StalePackageError, 409, 'STALE_PACKAGE'],
  ['NotAuthorisedError', NotAuthorisedError, 403, 'NOT_AUTHORISED'],
  ['SeparationOfDutiesError', SeparationOfDutiesError, 403, 'SEPARATION_OF_DUTIES'],
  ['InvalidPackageError', InvalidPackageError, 400, 'PACKAGE_INVALID'],
])('%s', (name, ErrorClass, statusCode, code) => {
  it('is an AppError with its own name, status and stable code', () => {
    const error = new ErrorClass('message');

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ name, statusCode, code, message: 'message' });
    expect(error.cause).toBeUndefined();
  });

  it('keeps the wrapped cause', () => {
    const cause = new Error('root');

    expect(new ErrorClass('message', { cause }).cause).toBe(cause);
  });
});

describe('StageConfigError', () => {
  const issues = [
    { source: '01-brief.yaml', path: 'steps.0.key', message: 'Invalid slug' },
    { source: '02-ux-design.yaml', path: '(root)', message: 'Missing gate' },
  ];

  it('is a 500 AppError with a stable code', () => {
    const error = new StageConfigError(issues);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      name: 'StageConfigError',
      statusCode: 500,
      code: 'STAGE_CONFIG_INVALID',
    });
  });

  it('keeps every issue and names each file and path in the message', () => {
    const error = new StageConfigError(issues);

    expect(error.issues).toEqual(issues);
    expect(error.message).toContain('01-brief.yaml: steps.0.key: Invalid slug');
    expect(error.message).toContain('02-ux-design.yaml: (root): Missing gate');
  });

  it('freezes the issues so callers cannot alter them', () => {
    expect(Object.isFrozen(new StageConfigError(issues).issues)).toBe(true);
  });

  it('keeps the wrapped cause', () => {
    const cause = new Error('yaml said no');

    expect(new StageConfigError(issues, { cause }).cause).toBe(cause);
  });
});
