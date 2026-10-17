// @ts-check
import { fastify, LogController } from 'fastify';
import { errorHandler, notFoundHandler } from './error-handler.js';
import { generateRequestId, REQUEST_ID_HEADER, REQUEST_ID_LOG_LABEL } from './request-id.js';
import { healthRoutes } from './routes/health.js';

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
 * @param {{ config: import('../config/index.js').Config, logger: import('pino').Logger }} deps
 *   Validated configuration and the shared logger.
 * @returns {AppServer} Configured Fastify instance.
 */
export function buildServer({ config, logger }) {
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
  return app;
}
