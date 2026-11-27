// @ts-check
import { fastify, LogController } from 'fastify';
import { errorHandler, notFoundHandler } from './error-handler.js';
import { generateRequestId, REQUEST_ID_HEADER, REQUEST_ID_LOG_LABEL } from './request-id.js';
import { ConfigError } from '../errors/index.js';
import { healthRoutes } from './routes/health.js';
import { readyRoutes } from './routes/ready.js';
import { stagesRoutes } from './routes/stages.js';
import { workflowRoutes } from './routes/workflow.js';

/**
 * @typedef {import('fastify').FastifyInstance<
 *   import('fastify').RawServerDefault,
 *   import('node:http').IncomingMessage,
 *   import('node:http').ServerResponse,
 *   import('pino').Logger
 * >} AppServer Fastify instance typed with the shared pino logger.
 */

/**
 * Build the Fastify app. Does not listen; the caller decides how to serve it.
 * @param {object} deps Dependencies.
 * @param {import('../config/index.js').Config} deps.config Validated configuration.
 * @param {import('pino').Logger} deps.logger Shared logger.
 * @param {ReadonlyArray<import('../stages/index.js').StageDefinition>} deps.stages Validated stages.
 * @param {() => Promise<boolean>} deps.readiness Whether dependencies (the database) are reachable.
 * @param {import('../initiatives/index.js').WorkflowService} [deps.workflow] Workflow service; its
 *   routes are registered only when config enables the workflow API.
 * @returns {AppServer} Configured Fastify instance.
 * @throws {ConfigError} When the workflow API is enabled without a workflow service.
 */
export function buildServer({ config, logger, stages, readiness, workflow }) {
  const app = fastify({
    loggerInstance: logger,
    genReqId: generateRequestId,
    logController: new LogController({ requestIdLogLabel: REQUEST_ID_LOG_LABEL }),
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);
  app.register(healthRoutes, { version: config.appVersion });
  app.register(stagesRoutes, { stages });
  app.register(readyRoutes, { readiness });
  if (config.workflowApiEnabled) {
    if (workflow === undefined) {
      throw new ConfigError('The workflow API is enabled but no workflow service was provided');
    }
    app.register(workflowRoutes, { workflow, authMode: config.authMode });
  }
  return app;
}
