// @ts-check
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/index.js';
import { buildTestServer } from './helpers.js';

/** @type {import('../../src/server/index.js').AppServer | undefined} */
let app;

afterEach(async () => {
  await app?.close();
});

describe('error handling', () => {
  it('returns 404 with the standard error body for an unknown route', async () => {
    ({ app } = buildTestServer());

    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not Found' } });
  });

  it('maps an AppError to its status and code without leaking cause or stack', async () => {
    ({ app } = buildTestServer());
    app.get('/stale', async () => {
      throw new AppError('Package changed', {
        statusCode: 409,
        code: 'STALE_PACKAGE',
        cause: new Error('db password=hunter2'),
      });
    });

    const response = await app.inject({ method: 'GET', url: '/stale' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'STALE_PACKAGE', message: 'Package changed' },
    });
    expect(response.body).not.toContain('hunter2');
    expect(response.body).not.toContain('stack');
  });

  it('hides the message of a 5xx AppError and logs the full error', async () => {
    const server = buildTestServer();
    app = server.app;
    app.get('/broken', async () => {
      throw new AppError('connection string leaked', { code: 'DB_DOWN' });
    });

    const response = await app.inject({ method: 'GET', url: '/broken' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(server.lines().some((line) => line.level === 'error' && line.err)).toBe(true);
  });

  it('turns an unexpected error into a generic 500', async () => {
    ({ app } = buildTestServer());
    app.get('/crash', async () => {
      throw new TypeError('secret internal detail');
    });

    const response = await app.inject({ method: 'GET', url: '/crash' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret internal detail');
  });

  it('passes a Fastify client error through with a generic message', async () => {
    ({ app } = buildTestServer());
    app.post('/echo', async (request) => request.body);

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'FST_ERR_CTP_INVALID_JSON_BODY', message: 'Bad Request' },
    });
  });
});
