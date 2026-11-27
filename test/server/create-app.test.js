// @ts-check
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StageConfigError } from '../../src/errors/index.js';
import { createApp } from '../../src/server/index.js';
import { captureLogger, REAL_STAGES_DIR, testConfig } from './helpers.js';

/** @type {import('../../src/server/index.js').AppServer | undefined} */
let app;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('createApp', () => {
  it('loads the stage configuration and serves it', async () => {
    const { logger } = captureLogger();

    app = await createApp({ config: { ...testConfig, stagesDir: REAL_STAGES_DIR }, logger });

    const response = await app.inject({ method: 'GET', url: '/stages' });
    expect(response.json().stages).toHaveLength(7);
  });

  it('refuses to start on an invalid stages directory', async () => {
    const { logger } = captureLogger();
    const stagesDir = join(REAL_STAGES_DIR, 'does-not-exist');

    await expect(createApp({ config: { ...testConfig, stagesDir }, logger })).rejects.toThrow(
      StageConfigError,
    );
  });

  it('logs the StageConfigError details at fatal level', async () => {
    const { logger, lines } = captureLogger();
    const stagesDir = join(REAL_STAGES_DIR, 'does-not-exist');

    await createApp({ config: { ...testConfig, stagesDir }, logger }).catch(() => undefined);

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

    await expect(
      createApp({ config: testConfig, logger, loadStages: () => Promise.reject(failure) }),
    ).rejects.toBe(failure);
    expect(lines().some((line) => line.msg === 'invalid stage configuration')).toBe(false);
  });
});
