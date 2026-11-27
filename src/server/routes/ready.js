// @ts-check

const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * Register `GET /ready`: 200 when the database answers, 503 when it doesn't. The ALB keeps
 * health-checking `/health` (liveness), so a database outage doesn't cycle the tasks.
 * @param {import('fastify').FastifyInstance} app Fastify instance to register on.
 * @param {{ readiness: () => Promise<boolean> }} options Readiness check.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function readyRoutes(app, { readiness }) {
  app.get('/ready', async (_request, reply) => {
    if (await readiness()) {
      return { status: 'ready' };
    }
    return reply.status(HTTP_SERVICE_UNAVAILABLE).send({ status: 'not_ready' });
  });
}
