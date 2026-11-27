// @ts-check
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalContentStore } from '../../src/content/index.js';
import { createWorkflowService } from '../../src/initiatives/index.js';
import { loadStages } from '../../src/stages/index.js';
import { createTestDatabase } from '../db/test-database.js';
import { buildTestServer, REAL_STAGES_DIR } from './helpers.js';

const AUTHOR = { 'x-dev-user-id': 'u-author', 'x-dev-user-roles': 'contributor' };
const REVIEWER = { 'x-dev-user-id': 'u-reviewer', 'x-dev-user-roles': 'product-owner' };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/** @type {import('../db/test-database.js').TestDatabase} */
let db;
/** @type {string} */
let dir;
/** @type {import('../../src/server/index.js').AppServer} */
let app;

beforeAll(async () => {
  db = await createTestDatabase();
  dir = await mkdtemp(join(tmpdir(), 'routes-content-'));
  const stages = await loadStages(REAL_STAGES_DIR);
  const workflow = createWorkflowService({
    pool: db.pool,
    stages,
    contentStore: createLocalContentStore({ dir }),
  });
  ({ app } = buildTestServer({
    stages,
    workflow,
    config: { workflowApiEnabled: true, authMode: 'dev-headers' },
  }));
});

afterAll(async () => {
  await app.close();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

/**
 * Send a JSON request.
 * @param {'GET' | 'POST'} method Method.
 * @param {string} url Path.
 * @param {Record<string, string>} headers Identity headers.
 * @param {unknown} [payload] Body.
 * @returns {Promise<import('light-my-request').Response>} Response.
 */
function send(method, url, headers, payload) {
  return app.inject({
    method,
    url,
    headers,
    payload: /** @type {Record<string, unknown> | undefined} */ (payload),
  });
}

describe('workflow routes', () => {
  /** @type {Record<string, string>} */
  const state = {};

  it('creates an Initiative (201)', async () => {
    const response = await send('POST', '/initiatives', AUTHOR, {
      title: 'Synthetic',
      request: 'A synthetic request.',
      notes: 'Notes.',
    });

    expect(response.statusCode).toBe(201);
    state.initiativeId = response.json().id;
  });

  it('reads the Initiative', async () => {
    const response = await send('GET', `/initiatives/${state.initiativeId}`, AUTHOR);

    expect(response.statusCode).toBe(200);
    const run = response.json().stageRuns[0];
    state.stageRunId = run.id;
    state.artifactId = run.artifacts.find(
      (/** @type {{ type: string }} */ a) => a.type === 'epics',
    ).id;
  });

  it('saves a version (201) and reads it back with its content', async () => {
    const saved = await send('POST', `/artifacts/${state.artifactId}/versions`, AUTHOR, {
      content: '# Epics',
    });
    state.versionId = saved.json().id;

    const read = await send('GET', `/versions/${state.versionId}`, AUTHOR);

    expect(saved.statusCode).toBe(201);
    expect(read.json()).toMatchObject({ number: 1, content: '# Epics' });
  });

  it('submits a package (201)', async () => {
    const response = await send('POST', `/stage-runs/${state.stageRunId}/packages`, AUTHOR, {
      versionIds: [state.versionId],
    });

    expect(response.statusCode).toBe(201);
    state.gateRunId = response.json().gateRunId;
    state.packageHash = response.json().packageHash;
  });

  it('refuses a stale package hash with 409', async () => {
    const response = await send('POST', `/gate-runs/${state.gateRunId}/decisions`, REVIEWER, {
      outcome: 'approve',
      packageHash: 'f'.repeat(64),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('STALE_PACKAGE');
  });

  it('refuses the package author with 403', async () => {
    const response = await send(
      'POST',
      `/gate-runs/${state.gateRunId}/decisions`,
      { 'x-dev-user-id': 'u-author', 'x-dev-user-roles': 'product-owner' },
      { outcome: 'approve', packageHash: state.packageHash },
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('SEPARATION_OF_DUTIES');
  });

  it('records a decision (201)', async () => {
    const response = await send('POST', `/gate-runs/${state.gateRunId}/decisions`, REVIEWER, {
      outcome: 'approve',
      packageHash: state.packageHash,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().move).toEqual({ kind: 'stage_approved' });
  });

  it('serves the timeline', async () => {
    const response = await send('GET', `/initiatives/${state.initiativeId}/timeline`, AUTHOR);

    expect(response.statusCode).toBe(200);
    expect(response.json().events.at(-1).action).toBe('initiative.awaiting_stage');
  });

  it('answers an open question', async () => {
    const question = await createQuestion(state.versionId);

    const response = await send('POST', `/open-questions/${question}/answer`, AUTHOR, {
      answer: 'Yes.',
    });

    expect(response.statusCode).toBe(200);
  });
});

/**
 * Raise a question directly through SQL (no route raises one in Phase 02).
 * @param {string} versionId Version.
 * @returns {Promise<string>} Question ID.
 */
async function createQuestion(versionId) {
  const { rows } = await db.pool.query(
    `INSERT INTO open_questions (version_id, text, blocking, status) VALUES ($1, 'Q?', false, 'open')
     RETURNING id`,
    [versionId],
  );
  return rows[0].id;
}

describe('workflow route errors', () => {
  it('refuses a request without identity with 401', async () => {
    const response = await send('POST', '/initiatives', {}, { title: 'x', request: 'x' });

    expect(response.statusCode).toBe(401);
  });

  it.each([
    ['POST', '/initiatives', { title: '', request: 'x' }],
    ['POST', '/initiatives', { title: 'x' }],
    ['POST', '/initiatives', { title: 'x', request: 'x', extra: 1 }],
    ['GET', '/initiatives/not-a-uuid', undefined],
    ['POST', `/gate-runs/${UNKNOWN_ID}/decisions`, { outcome: 'maybe', packageHash: 'x' }],
    ['POST', `/stage-runs/${UNKNOWN_ID}/packages`, { versionIds: [] }],
  ])('refuses %s %s with an invalid body or id (400)', async (method, url, payload) => {
    const response = await send(/** @type {'GET' | 'POST'} */ (method), url, AUTHOR, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['a NUL character', 'nul\u0000here'],
    ['a lone surrogate', 'broken\ud800text'],
  ])('refuses text containing %s with 400, not a database error', async (_name, title) => {
    const response = await send('POST', '/initiatives', AUTHOR, { title, request: 'x' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('title');
  });

  it('names the failing field but never echoes the value', async () => {
    const response = await send('POST', '/initiatives', AUTHOR, { title: 'x', request: 42 });

    expect(response.json().error.message).toContain('request');
    expect(response.json().error.message).not.toContain('42');
  });

  it('returns 404 for an unknown Initiative', async () => {
    const response = await send('GET', `/initiatives/${UNKNOWN_ID}`, AUTHOR);

    expect(response.statusCode).toBe(404);
  });
});

describe('when the workflow API is off', () => {
  it.each([
    ['POST', '/initiatives'],
    ['GET', `/initiatives/${UNKNOWN_ID}`],
    ['POST', `/gate-runs/${UNKNOWN_ID}/decisions`],
  ])('does not register %s %s (404)', async (method, url) => {
    const { app: off } = buildTestServer();

    const response = await off.inject({
      method: /** @type {'GET' | 'POST'} */ (method),
      url,
      headers: REVIEWER,
      payload: method === 'POST' ? {} : undefined,
    });
    await off.close();

    expect(response.statusCode).toBe(404);
  });
});
