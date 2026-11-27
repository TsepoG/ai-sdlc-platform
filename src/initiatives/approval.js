// @ts-check
import { enqueueJob } from '../jobs/index.js';
import { audit, updateInitiative } from './context.js';
import { nextStage } from './plan.js';
import { startStageRun } from './stage-runs.js';

/** @import { StageDefinition } from '../stages/index.js' */
/** @import { Actor, InitiativeRow, WorkflowDeps } from './context.js' */
/** @import { StageRunRow } from './stage-runs.js' */

/**
 * @typedef {object} ApprovalContext
 * @property {InitiativeRow} initiative Locked Initiative.
 * @property {StageRunRow} stageRun Stage run being approved.
 * @property {StageDefinition} stage Its definition.
 * @property {string} packageId The approved package.
 * @property {string} [decisionId] The approving decision; outbox jobs record it.
 */

/**
 * Approve a stage run with its package, queue its outbox job, and hand the Initiative over to
 * the next stage.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who approved.
 * @param {ApprovalContext} approval What was approved.
 * @returns {Promise<void>}
 */
export async function approveStage(tx, deps, actor, approval) {
  const { initiative, stageRun, stage, packageId, decisionId } = approval;
  const now = deps.now();
  await tx.query(`UPDATE review_packages SET status = 'approved' WHERE id = $1`, [packageId]);
  await tx.query(`UPDATE stage_runs SET state = 'approved', completed_at = $2 WHERE id = $1`, [
    stageRun.id,
    now,
  ]);
  audit(
    tx,
    deps,
    actor,
    'stage_run.approved',
    { type: 'stage_run', id: stageRun.id },
    initiative.id,
    {
      stageKey: stage.key,
      packageId,
    },
  );
  // Outbox: downstream work for an approval is queued in the approving transaction, keyed by the
  // approved package so a retry can never queue it twice. Phase 02 only logs it.
  await enqueueJob(
    tx,
    {
      type: 'log',
      payload: {
        event: 'stage.approved',
        initiativeId: initiative.id,
        stageKey: stage.key,
        packageId,
      },
      idempotencyKey: `stage-approved:${packageId}`,
      decisionId,
    },
    { now: deps.now },
  );
  await handOff(tx, deps, actor, approval);
}

/**
 * Move the Initiative on: start the next stage if it is enabled, wait at it if not, or finish
 * after the last stage.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who approved.
 * @param {ApprovalContext} approval What was approved.
 * @returns {Promise<void>}
 */
async function handOff(tx, deps, actor, { initiative, stage, packageId }) {
  const next = nextStage(deps.stages, stage.key);
  const entity = { type: 'initiative', id: initiative.id };
  if (next === undefined) {
    await updateInitiative(tx, deps, initiative.id, { status: 'done', currentStageKey: stage.key });
    audit(tx, deps, actor, 'initiative.done', entity, initiative.id, { stageKey: stage.key });
    return;
  }
  if (!next.enabled) {
    await updateInitiative(tx, deps, initiative.id, {
      status: 'awaiting_stage',
      currentStageKey: next.key,
    });
    audit(tx, deps, actor, 'initiative.awaiting_stage', entity, initiative.id, {
      stageKey: next.key,
    });
    return;
  }
  await updateInitiative(tx, deps, initiative.id, { status: 'active', currentStageKey: next.key });
  await startStageRun(tx, deps, actor, { initiative, stage: next, inputPackageId: packageId });
}
