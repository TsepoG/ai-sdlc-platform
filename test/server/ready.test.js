// @ts-check
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestServer } from './helpers.js';

/** @type {import('../../src/server/index.js').AppServer | undefined} */
let app;

afterEach(async () => {
  await app?.close();
});

describe('GET /ready', () => {
  it('responds 200 when the database is reachable', async () => {
    ({ app } = buildTestServer({ readiness: async () => true }));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it('responds 503 when the database is not reachable', async () => {
    ({ app } = buildTestServer({ readiness: async () => false }));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
  });
});
