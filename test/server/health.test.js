// @ts-check
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestServer, testConfig } from './helpers.js';

/** @type {import('../../src/server/index.js').AppServer | undefined} */
let app;

afterEach(async () => {
  await app?.close();
});

describe('GET /health', () => {
  it('responds 200 with status ok and the configured version', async () => {
    ({ app } = buildTestServer());

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: testConfig.appVersion });
  });

  it('generates a request ID header when the caller sends none', async () => {
    ({ app } = buildTestServer());

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a safe caller-supplied request ID and logs it', async () => {
    const server = buildTestServer();
    app = server.app;

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-123' },
    });

    expect(response.headers['x-request-id']).toBe('trace-123');
    expect(server.lines().some((line) => line.requestId === 'trace-123')).toBe(true);
  });

  it('replaces an unsafe caller-supplied request ID', async () => {
    ({ app } = buildTestServer());

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'bad id with spaces' },
    });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
