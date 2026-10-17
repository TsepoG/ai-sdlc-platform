// @ts-check
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger/index.js';

/**
 * Build a logger that captures its output lines in memory.
 * @param {string} [level] Minimum level.
 * @returns {{ logger: import('pino').Logger, lines: () => Record<string, unknown>[] }} Logger and reader.
 */
function captureLogger(level = 'info') {
  /** @type {string[]} */
  const chunks = [];
  const logger = createLogger({
    level,
    version: '1.2.3',
    env: 'local',
    destination: { write: (chunk) => void chunks.push(chunk) },
  });
  return { logger, lines: () => chunks.map((chunk) => JSON.parse(chunk)) };
}

describe('createLogger', () => {
  it('emits JSON with a text level, message and base fields', () => {
    const { logger, lines } = captureLogger();

    logger.info('hello');

    expect(lines()[0]).toMatchObject({
      level: 'info',
      msg: 'hello',
      service: 'ai-sdlc-platform',
      version: '1.2.3',
      env: 'local',
    });
  });

  it('includes the request ID on lines from a child logger', () => {
    const { logger, lines } = captureLogger();

    logger.child({ requestId: 'req-1' }).warn('slow');

    expect(lines()[0]).toMatchObject({ level: 'warn', requestId: 'req-1' });
  });

  it('suppresses lines below the configured level', () => {
    const { logger, lines } = captureLogger('warn');

    logger.info('quiet');
    logger.error('loud');

    expect(lines().map((line) => line.msg)).toEqual(['loud']);
  });

  it('redacts authorization and cookie headers', () => {
    const { logger, lines } = captureLogger();

    logger.info({ req: { headers: { authorization: 'Bearer secret', cookie: 'sid=1' } } }, 'req');

    const output = JSON.stringify(lines()[0]);
    expect(output).not.toContain('Bearer secret');
    expect(output).not.toContain('sid=1');
  });
});
