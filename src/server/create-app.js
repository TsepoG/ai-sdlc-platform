// @ts-check
import { StageConfigError } from '../errors/index.js';
import { loadStages as loadStageFiles } from '../stages/index.js';
import { buildServer } from './build-server.js';

/**
 * Load and validate everything the server needs, then build it. The server never starts on
 * invalid stage configuration.
 * @param {object} deps Dependencies.
 * @param {import('../config/index.js').Config} deps.config Validated configuration.
 * @param {import('pino').Logger} deps.logger Shared logger.
 * @param {(dir: string) => Promise<ReadonlyArray<import('../stages/index.js').StageDefinition>>} [deps.loadStages]
 *   Stage loader (defaults to reading `config.stagesDir` from disk).
 * @returns {Promise<import('./build-server.js').AppServer>} Configured Fastify instance (not listening).
 * @throws {StageConfigError} When the stage configuration is invalid; the details are logged first.
 */
export async function createApp({ config, logger, loadStages = loadStageFiles }) {
  try {
    const stages = await loadStages(config.stagesDir);
    logger.info(
      { stages: stages.length, stagesDir: config.stagesDir },
      'stage configuration loaded',
    );
    return buildServer({ config, logger, stages });
  } catch (error) {
    if (error instanceof StageConfigError) {
      logger.fatal({ err: error, issues: error.issues }, 'invalid stage configuration');
    }
    throw error;
  }
}
