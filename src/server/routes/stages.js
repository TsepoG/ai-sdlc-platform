// @ts-check

/** @import { StageDefinition } from '../../stages/index.js' */

/**
 * @typedef {object} StageSummary
 * @property {string} key Stage key.
 * @property {string} name Display name.
 * @property {number} order Position in the workflow.
 * @property {boolean} enabled Whether Initiatives can enter the stage.
 * @property {{ key: string, type: string, condition: string | null }[]} steps Steps in order.
 */

/**
 * Reduce a stage to the fields the read-only API exposes.
 * @param {StageDefinition} stage Validated stage.
 * @returns {StageSummary} Public summary.
 */
function summarise(stage) {
  return {
    key: stage.key,
    name: stage.name,
    order: stage.order,
    enabled: stage.enabled,
    steps: stage.steps.map((step) => ({
      key: step.key,
      type: step.type,
      condition: step.condition ?? null,
    })),
  };
}

/**
 * Register `GET /stages`: the loaded stage configuration, read-only.
 * @param {import('fastify').FastifyInstance} app Fastify instance to register on.
 * @param {{ stages: ReadonlyArray<StageDefinition> }} options Stages loaded at startup.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function stagesRoutes(app, { stages }) {
  // Stage config is fixed for the life of the process, so the body is built once.
  const body = Object.freeze({ stages: stages.map(summarise) });
  app.get('/stages', async () => body);
}
