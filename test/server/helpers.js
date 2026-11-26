// @ts-check
import { join } from 'node:path';
import { buildServer } from '../../src/server/index.js';
import { createLogger } from '../../src/logger/index.js';

/** The repository's real stage configuration. */
export const REAL_STAGES_DIR = join(import.meta.dirname, '../../config/stages');

/** @type {import('../../src/config/index.js').Config} */
export const testConfig = {
  nodeEnv: 'test',
  port: 8080,
  logLevel: 'info',
  appVersion: '9.9.9-test',
  platformEnv: 'local',
  stagesDir: REAL_STAGES_DIR,
};

/**
 * Create a logger whose lines are captured in memory.
 * @returns {{ logger: import('pino').Logger, lines: () => Record<string, unknown>[] }}
 *   The logger and a reader for what it logged.
 */
export function captureLogger() {
  /** @type {string[]} */
  const chunks = [];
  const logger = createLogger({
    level: 'info',
    version: testConfig.appVersion,
    env: testConfig.platformEnv,
    destination: { write: (chunk) => void chunks.push(chunk) },
  });
  return { logger, lines: () => chunks.map((chunk) => JSON.parse(chunk)) };
}

/**
 * Build a server whose log lines are captured in memory.
 * @param {{ stages?: ReadonlyArray<import('../../src/stages/index.js').StageDefinition> }} [options]
 *   Stages to serve (default none).
 * @returns {{ app: import('../../src/server/index.js').AppServer, lines: () => Record<string, unknown>[] }}
 *   The app and a reader for what it logged.
 */
export function buildTestServer({ stages = [] } = {}) {
  const { logger, lines } = captureLogger();
  const app = buildServer({ config: testConfig, logger, stages });
  return { app, lines };
}
