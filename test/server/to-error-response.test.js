// @ts-check
import { describe, expect, it } from 'vitest';
import { toErrorResponse } from '../../src/server/error-handler.js';

describe('toErrorResponse', () => {
  it('falls back to BAD_REQUEST when a 4xx error has no code', () => {
    const error = Object.assign(new Error('bad input'), { statusCode: 422 });

    const { statusCode, body } = toErrorResponse(error);

    expect(statusCode).toBe(422);
    expect(body.error).toEqual({ code: 'BAD_REQUEST', message: 'Unprocessable Entity' });
  });

  it('uses a generic message for a 4xx status Node does not name', () => {
    const error = Object.assign(new Error('odd'), { statusCode: 499 });

    expect(toErrorResponse(error).body.error.message).toBe('Bad request');
  });

  it('treats a non-4xx statusCode on a plain error as a 500', () => {
    const error = Object.assign(new Error('weird'), { statusCode: 302 });

    expect(toErrorResponse(error).statusCode).toBe(500);
  });
});
