// @ts-check
import { enqueueJob } from '../jobs/index.js';
import { audit, updateInitiative } from './context.js';
import { findStaleRuns, nextStage } from './plan.js';
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
 */

/**
 * Approve a stage run with its package, flag downstream runs whose inputs this re-approval
 * changed, and hand the Initiative over to the next stage.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who approved.
 * @param {ApprovalContext} approval What was approved.
 * @returns {Promise<void>}
 */
export async function approveStage(tx, deps, actor, approval) {
  const { initiative, stageRun, stage, packageId } = approval;
  const now = deps.now();
  await tx.query(`UPDATE review_packages SET status = 'approved' WHERE id = $1`, [packageId]);
  await tx.query(`UPDATE stage_runs SET state = 'approved', completed_at = $2 WHERE id = $1`, [
    stageRun.id,
    now,
  ]);
  await audit(
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
    },
    { now: deps.now },
  );
  await flagUpstreamChanged(tx, deps, actor, approval);
  await handOff(tx, deps, actor, approval);
}

/**
 * Flag approved downstream runs that were built on an older package of this stage.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who approved.
 * @param {ApprovalContext} approval What was approved.
 * @returns {Promise<void>}
 */
async function flagUpstreamChanged(tx, deps, actor, { initiative, stageRun, packageId }) {
  const { rows: runs } = await tx.query(
    `SELECT id, stage_key AS "stageKey", state, input_package_id AS "inputPackageId"
     FROM stage_runs WHERE initiative_id = $1`,
    [initiative.id],
  );
  const { rows: packages } = await tx.query(
    `SELECT p.id, p.stage_run_id AS "stageRunId" FROM review_packages p
     JOIN stage_runs r ON r.id = p.stage_run_id WHERE r.initiative_id = $1`,
    [initiative.id],
  );
  const stale = findStaleRuns({
    runs,
    packages,
    approvedRunId: stageRun.id,
    approvedPackageId: packageId,
  });
  for (const runId of stale) {
    await tx.query(`UPDATE stage_runs SET state = 'upstream_changed' WHERE id = $1`, [runId]);
    await audit(
      tx,
      deps,
      actor,
      'stage_run.upstream_changed',
      { type: 'stage_run', id: runId },
      initiative.id,
      {
        changedStageRunId: stageRun.id,
        packageId,
      },
    );
  }
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
    await audit(tx, deps, actor, 'initiative.done', entity, initiative.id, { stageKey: stage.key });
    return;
  }
  if (!next.enabled) {
    await updateInitiative(tx, deps, initiative.id, {
      status: 'awaiting_stage',
      currentStageKey: next.key,
    });
    await audit(tx, deps, actor, 'initiative.awaiting_stage', entity, initiative.id, {
      stageKey: next.key,
    });
    return;
  }
  await updateInitiative(tx, deps, initiative.id, { status: 'active', currentStageKey: next.key });
  await startStageRun(tx, deps, actor, { initiative, stage: next, inputPackageId: packageId });
}
