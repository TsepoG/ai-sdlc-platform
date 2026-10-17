// @ts-check

/**
 * Register `GET /health`, used by the ALB target group and the deploy smoke test.
 * @param {import('fastify').FastifyInstance} app Fastify instance to register on.
 * @param {{ version: string }} options Version reported in the response body.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function healthRoutes(app, { version }) {
  app.get('/health', async () => ({ status: 'ok', version }));
}
