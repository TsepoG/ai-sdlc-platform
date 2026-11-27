// @ts-check
import { resolveIdentity } from '../dev-identity.js';
import {
  answerBody,
  createInitiativeBody,
  decisionBody,
  idParams,
  parseInput,
  saveVersionBody,
  submitPackageBody,
} from './workflow-schemas.js';

const HTTP_CREATED = 201;

/**
 * Register the workflow routes. Registered only when config enables the workflow API, which it
 * refuses outside local and test: the dev load balancer is public and has no SSO yet.
 * @param {import('fastify').FastifyInstance} app Fastify instance to register on.
 * @param {{ workflow: import('../../initiatives/index.js').WorkflowService, authMode: 'none' | 'dev-headers' }} options
 *   Workflow service and auth mode.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function workflowRoutes(app, { workflow, authMode }) {
  /**
   * Resolve the caller, or throw 401.
   * @param {import('fastify').FastifyRequest} request Request.
   * @returns {import('../dev-identity.js').Identity} The caller.
   */
  const who = (request) => resolveIdentity(request, authMode);

  app.post('/initiatives', async (request, reply) => {
    const { actor } = who(request);
    const input = parseInput(createInitiativeBody, request.body);
    return reply.status(HTTP_CREATED).send(await workflow.createInitiative(input, actor));
  });

  app.get('/initiatives/:id', async (request) => {
    who(request);
    return workflow.getInitiative(parseInput(idParams, request.params).id);
  });

  app.get('/initiatives/:id/timeline', async (request) => {
    who(request);
    return { events: await workflow.getTimeline(parseInput(idParams, request.params).id) };
  });

  app.post('/artifacts/:id/versions', async (request, reply) => {
    const { actor } = who(request);
    const { id } = parseInput(idParams, request.params);
    const input = parseInput(saveVersionBody, request.body);
    return reply.status(HTTP_CREATED).send(await workflow.saveVersion(id, input, actor));
  });

  app.get('/versions/:id', async (request) => {
    who(request);
    return workflow.getVersion(parseInput(idParams, request.params).id);
  });

  app.post('/stage-runs/:id/packages', async (request, reply) => {
    const { actor } = who(request);
    const { id } = parseInput(idParams, request.params);
    const { versionIds } = parseInput(submitPackageBody, request.body);
    return reply.status(HTTP_CREATED).send(await workflow.submitPackage(id, versionIds, actor));
  });

  app.post('/gate-runs/:id/decisions', async (request, reply) => {
    const { actor, roles } = who(request);
    const { id } = parseInput(idParams, request.params);
    const input = parseInput(decisionBody, request.body);
    return reply.status(HTTP_CREATED).send(await workflow.decide(id, input, actor, roles));
  });

  app.post('/open-questions/:id/answer', async (request) => {
    const { actor } = who(request);
    const { id } = parseInput(idParams, request.params);
    return workflow.answerQuestion(id, parseInput(answerBody, request.body), actor);
  });
}
