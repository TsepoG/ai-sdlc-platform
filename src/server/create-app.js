// @ts-check
import { createContentStore } from '../content/index.js';
import { createPool, migrate, pingDatabase } from '../db/index.js';
import { StageConfigError } from '../errors/index.js';
import { createWorkflowService } from '../initiatives/index.js';
import { createJobWorker, createLogHandler } from '../jobs/index.js';
import { loadStages as loadStageFiles } from '../stages/index.js';
import { buildServer } from './build-server.js';

/** @import { StageDefinition } from '../stages/index.js' */

/**
 * @typedef {object} AppDeps
 * @property {import('../config/index.js').Config} config Validated configuration.
 * @property {import('pino').Logger} logger Shared logger.
 * @property {(dir: string) => Promise<ReadonlyArray<StageDefinition>>} [loadStages] Stage loader
 *   (defaults to reading `config.stagesDir` from disk).
 * @property {import('pg').Pool} [pool] Database pool to use instead of one built from config
 *   (the caller then owns closing it).
 * @property {import('../content/index.js').ContentStore} [contentStore] Content store to use
 *   instead of one built from config.
 */

/**
 * Load and validate the stage configuration, logging the details when it is invalid.
 * @param {AppDeps} deps Dependencies.
 * @returns {Promise<ReadonlyArray<StageDefinition>>} Validated stages.
 * @throws {StageConfigError} When the configuration is invalid.
 */
async function loadValidatedStages({ config, logger, loadStages = loadStageFiles }) {
  try {
    const stages = await loadStages(config.stagesDir);
    logger.info(
      { stages: stages.length, stagesDir: config.stagesDir },
      'stage configuration loaded',
    );
    return stages;
  } catch (error) {
    if (error instanceof StageConfigError) {
      logger.fatal({ err: error, issues: error.issues }, 'invalid stage configuration');
    }
    throw error;
  }
}

/**
 * Prepare everything the service needs, in order, failing fast: stage config, database
 * connection and migrations (applied before the server listens), content store, workflow
 * service and the job worker. Closing the server stops the worker and closes the pool.
 * @param {AppDeps} deps Dependencies.
 * @returns {Promise<import('./build-server.js').AppServer>} Configured Fastify instance (not listening).
 * @throws {StageConfigError} When the stage configuration is invalid; the details are logged first.
 * @throws {import('../errors/index.js').MigrationError} When migrations cannot be applied.
 */
export async function createApp(deps) {
  const { config, logger } = deps;
  const stages = await loadValidatedStages(deps);
  const ownsPool = deps.pool === undefined;
  const pool = deps.pool ?? createPool(config.database, { logger });
  try {
    await migrate(pool, { logger });
  } catch (error) {
    if (ownsPool) {
      await pool.end();
    }
    throw error;
  }
  const contentStore = deps.contentStore ?? createContentStore(config.content);
  const workflow = createWorkflowService({ pool, stages, contentStore });
  const worker = createJobWorker({
    pool,
    handlers: { log: createLogHandler(logger) },
    settings: config.worker,
    logger,
  });
  const app = buildServer({
    config,
    logger,
    stages,
    readiness: () => pingDatabase(pool),
    workflow,
  });
  if (config.worker.enabled) {
    worker.start();
  }
  app.addHook('onClose', async () => {
    await worker.stop();
    if (ownsPool) {
      await pool.end();
    }
  });
  return app;
}
