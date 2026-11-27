// @ts-check
import { InvalidTransitionError } from '../errors/index.js';
import { audit, workflowTransaction } from './context.js';
import { startStageRun } from './stage-runs.js';

/** @import { Actor, WorkflowDeps } from './context.js' */

/** Input types the create request carries: the business request and stakeholder notes. */
const REQUEST_TYPE = 'business-request';
const NOTES_TYPE = 'stakeholder-notes';

/**
 * @typedef {object} CreateInitiativeInput
 * @property {string} title Initiative title.
 * @property {string} request The business request.
 * @property {string} [notes] Stakeholder notes.
 * @property {Record<string, boolean>} [flags] Initiative flags, e.g. `{ requiresTdf: true }`.
 */

/**
 * Create an Initiative, start its first stage and store the request (and notes) as
 * user-created input versions — all in one transaction with its audit events.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {CreateInitiativeInput} input What to create.
 * @param {Actor} actor Who is creating it (the requester).
 * @returns {Promise<{ id: string, key: string }>} The new Initiative's ID and key.
 * @throws {InvalidTransitionError} When the first stage is not enabled.
 */
export async function createInitiative(deps, input, actor) {
  const first = [...deps.stages].sort((a, b) => a.order - b.order)[0];
  if (!first.enabled) {
    throw new InvalidTransitionError(`The first stage "${first.key}" is not enabled`);
  }
  // Content goes in first: it is content-addressed, so an aborted transaction only leaves an
  // unreferenced object behind, never a reference to missing content.
  const inputs = [{ type: REQUEST_TYPE, title: 'Business request', content: input.request }];
  if (input.notes !== undefined && input.notes !== '') {
    inputs.push({ type: NOTES_TYPE, title: 'Stakeholder notes', content: input.notes });
  }
  const stored = await Promise.all(inputs.map((each) => deps.contentStore.put(each.content)));
  const flags = input.flags ?? {};

  return workflowTransaction(deps, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO initiatives (title, requester_id, owner_id, status, current_stage_key, flags,
         created_at, updated_at)
       VALUES ($1, $2, $2, 'active', $3, $4, $5, $5) RETURNING id, key, status, current_stage_key, flags`,
      [input.title, actor.id, first.key, flags, deps.now()],
    );
    const initiative = rows[0];
    audit(
      tx,
      deps,
      actor,
      'initiative.created',
      { type: 'initiative', id: initiative.id },
      initiative.id,
      {
        key: initiative.key,
        title: input.title,
        flags,
      },
    );
    const stageRunId = await startStageRun(tx, deps, actor, {
      initiative,
      stage: first,
      inputPackageId: null,
    });
    for (const [index, each] of inputs.entries()) {
      const { rows: artifacts } = await tx.query(
        `INSERT INTO artifacts (initiative_id, stage_run_id, type, title)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [initiative.id, stageRunId, each.type, each.title],
      );
      const { rows: versions } = await tx.query(
        `INSERT INTO artifact_versions (artifact_id, number, content_key, content_hash, format,
           created_by_type, created_by_id, created_at)
         VALUES ($1, 1, $2, $3, 'text', $4, $5, $6) RETURNING id`,
        [artifacts[0].id, stored[index].key, stored[index].hash, actor.type, actor.id, deps.now()],
      );
      audit(
        tx,
        deps,
        actor,
        'version.saved',
        { type: 'artifact_version', id: versions[0].id },
        initiative.id,
        {
          artifactId: artifacts[0].id,
          artifactType: each.type,
          number: 1,
          contentHash: stored[index].hash,
        },
      );
    }
    return { id: initiative.id, key: initiative.key };
  });
}
