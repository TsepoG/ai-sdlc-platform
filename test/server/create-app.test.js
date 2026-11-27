// @ts-check
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalContentStore } from '../../src/content/index.js';
import { StageConfigError } from '../../src/errors/index.js';
import { createApp } from '../../src/server/index.js';
import { createTestDatabase } from '../db/test-database.js';
import { captureLogger, REAL_STAGES_DIR, testConfig } from './helpers.js';

/** @type {import('../db/test-database.js').TestDatabase} */
let db;
/** @type {string} */
let dir;
/** @type {import('../../src/server/index.js').AppServer | undefined} */
let app;

beforeEach(async () => {
  db = await createTestDatabase({ migrated: false });
  dir = await mkdtemp(join(tmpdir(), 'app-content-'));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

/**
 * Create the app on the test database.
 * @param {Partial<import('../../src/server/create-app.js').AppDeps>} [overrides] Overrides.
 * @returns {Promise<import('../../src/server/index.js').AppServer>} The app.
 */
function create(overrides = {}) {
  return createApp({
    config: testConfig,
    logger: captureLogger().logger,
    pool: db.pool,
    contentStore: createLocalContentStore({ dir }),
    ...overrides,
  });
}

describe('createApp', () => {
  it('migrates the database before serving, and reports ready', async () => {
    app = await create();

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    const { rows } = await db.pool.query('SELECT version FROM schema_migrations');

    expect(ready.statusCode).toBe(200);
    expect(rows.map((row) => row.version)).toContain('0001_initial_schema');
  });

  it('serves the stage configuration', async () => {
    app = await create();

    const response = await app.inject({ method: 'GET', url: '/stages' });

    expect(response.json().stages).toHaveLength(7);
  });

  it('refuses to start on an invalid stages directory', async () => {
    const stagesDir = join(REAL_STAGES_DIR, 'does-not-exist');

    await expect(create({ config: { ...testConfig, stagesDir } })).rejects.toThrow(
      StageConfigError,
    );
  });

  it('logs the StageConfigError details at fatal level', async () => {
    const { logger, lines } = captureLogger();
    const stagesDir = join(REAL_STAGES_DIR, 'does-not-exist');

    await create({ config: { ...testConfig, stagesDir }, logger }).catch(() => undefined);

    expect(lines()).toContainEqual(
      expect.objectContaining({
        level: 'fatal',
        msg: 'invalid stage configuration',
        issues: [expect.objectContaining({ source: stagesDir, path: '(root)' })],
      }),
    );
  });

  it('rethrows an unexpected loader error without logging it as a config problem', async () => {
    const { logger, lines } = captureLogger();
    const failure = new Error('disk on fire');

    await expect(create({ logger, loadStages: () => Promise.reject(failure) })).rejects.toBe(
      failure,
    );
    expect(lines().some((line) => line.msg === 'invalid stage configuration')).toBe(false);
  });

  it('refuses to start when migrations fail, closing the pool it opened', async () => {
    const config = {
      ...testConfig,
      database: { ...testConfig.database, host: '127.0.0.1', port: 1, name: 'none' },
    };

    await expect(create({ config, pool: undefined })).rejects.toThrow();
  });

  it('starts the job worker when enabled and stops it on close', async () => {
    app = await create({
      config: { ...testConfig, worker: { ...testConfig.worker, enabled: true, pollIntervalMs: 5 } },
    });
    await db.pool.query(
      `INSERT INTO jobs (type, payload, idempotency_key) VALUES ('log', '{}', 'startup-check')`,
    );

    let status = 'pending';
    for (let wait = 0; wait < 100 && status !== 'done'; wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      ({ status } = (await db.pool.query('SELECT status FROM jobs')).rows[0]);
    }

    expect(status).toBe('done');
  });

  it('registers the workflow routes only when enabled', async () => {
    app = await create({
      config: { ...testConfig, workflowApiEnabled: true, authMode: 'dev-headers' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/initiatives/00000000-0000-4000-8000-000000000000',
      headers: { 'x-dev-user-id': 'u' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe('Initiative not found');
  });
});
