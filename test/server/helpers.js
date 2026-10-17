// @ts-check
import { buildServer } from '../../src/server/index.js';
import { createLogger } from '../../src/logger/index.js';

/** @type {import('../../src/config/index.js').Config} */
export const testConfig = {
  nodeEnv: 'test',
  port: 8080,
  logLevel: 'info',
  appVersion: '9.9.9-test',
  platformEnv: 'local',
};

/**
 * Build a server whose log lines are captured in memory.
 * @returns {{ app: import('../../src/server/index.js').AppServer, lines: () => Record<string, unknown>[] }}
 *   The app and a reader for what it logged.
 */
export function buildTestServer() {
  /** @type {string[]} */
  const chunks = [];
  const logger = createLogger({
    level: 'info',
    version: testConfig.appVersion,
    env: testConfig.platformEnv,
    destination: { write: (chunk) => void chunks.push(chunk) },
  });
  const app = buildServer({ config: testConfig, logger });
  return { app, lines: () => chunks.map((chunk) => JSON.parse(chunk)) };
}
