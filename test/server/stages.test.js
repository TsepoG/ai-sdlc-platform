// @ts-check
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadStages } from '../../src/stages/index.js';
import { buildTestServer, REAL_STAGES_DIR } from './helpers.js';

/** @type {import('../../src/server/index.js').AppServer | undefined} */
let app;
/** @type {ReadonlyArray<import('../../src/stages/index.js').StageDefinition>} */
let stages;

beforeAll(async () => {
  stages = await loadStages(REAL_STAGES_DIR);
});

afterEach(async () => {
  await app?.close();
});

describe('GET /stages', () => {
  it('lists the seven stages in order with key, name, order and enabled', async () => {
    ({ app } = buildTestServer({ stages }));

    const response = await app.inject({ method: 'GET', url: '/stages' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.stages).toHaveLength(7);
    expect(body.stages[0]).toMatchObject({ key: 'brief', name: 'Brief', order: 1, enabled: true });
    expect(body.stages.map((/** @type {{ key: string }} */ stage) => stage.key)).toEqual(
      stages.map((stage) => stage.key),
    );
  });

  it('lists each step with only key, type and condition', async () => {
    ({ app } = buildTestServer({ stages }));

    const response = await app.inject({ method: 'GET', url: '/stages' });

    const test = response.json().stages.at(-1);
    expect(test.steps[0]).toEqual({ key: 'deploy-sit', type: 'action', condition: null });
    expect(test.steps.at(-1)).toEqual({
      key: 'preprod-signoff',
      type: 'gate',
      condition: 'initiative.flags.requiresPreprod',
    });
  });

  it('does not expose agents, roles or inputs', async () => {
    ({ app } = buildTestServer({ stages }));

    const response = await app.inject({ method: 'GET', url: '/stages' });

    const keys = Object.keys(response.json().stages[0]);
    expect(keys).toHaveLength(5);
    expect(keys).toEqual(expect.arrayContaining(['enabled', 'key', 'name', 'order', 'steps']));
  });

  it('refuses writes to /stages', async () => {
    ({ app } = buildTestServer({ stages }));

    const response = await app.inject({ method: 'POST', url: '/stages', payload: {} });

    expect(response.statusCode).toBe(404);
  });
});
