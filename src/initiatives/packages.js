// @ts-check
import {
  BlockingQuestionsError,
  InvalidPackageError,
  InvalidTransitionError,
  NotFoundError,
} from '../errors/index.js';
import { nextMove, packageHash } from '../workflow/index.js';
import { audit, lockInitiative, workflowTransaction } from './context.js';
import { applyMove } from './moves.js';
import { stageByKey } from './plan.js';
import { currentCycleSteps, insertCycle, lockStageRun } from './stage-runs.js';

/** @import { Actor, InitiativeRow, WorkflowDeps } from './context.js' */
/** @import { StageRunRow } from './stage-runs.js' */
/** @import { StageDefinition } from '../stages/index.js' */

/**
 * @typedef {object} SubmittedPackage
 * @property {string} id Package ID.
 * @property {string} packageHash Hash reviewers must decide against.
 * @property {string[]} versionIds Versions in the package.
 * @property {string | null} gateRunId The gate now waiting for a decision, if one opened.
 */

/**
 * Submit versions for review. Refuses while blocking questions are unanswered; supersedes any
 * open package; completes the running work step through `nextMove`, which opens the next gate.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} stageRunId Stage run the versions belong to.
 * @param {string[]} versionIds Versions to submit (one per artifact).
 * @param {Actor} actor Who is submitting.
 * @returns {Promise<SubmittedPackage>} The open package.
 * @throws {NotFoundError} When the stage run does not exist.
 * @throws {InvalidPackageError} When the versions are empty, repeated or not this stage's outputs.
 * @throws {BlockingQuestionsError} While a blocking open question is unanswered.
 * @throws {InvalidTransitionError} When the stage run is not active or nothing awaits a package.
 */
export async function submitPackage(deps, stageRunId, versionIds, actor) {
  const owner = await deps.pool.query('SELECT initiative_id FROM stage_runs WHERE id = $1', [
    stageRunId,
  ]);
  if (owner.rows.length === 0) {
    throw new NotFoundError('Stage run not found');
  }
  return workflowTransaction(deps, async (tx) => {
    const initiative = await lockInitiative(tx, owner.rows[0].initiative_id);
    const stageRun = /** @type {StageRunRow} */ (await lockStageRun(tx, stageRunId));
    if (stageRun.state !== 'active') {
      throw new InvalidTransitionError(`Stage run is ${stageRun.state}, not active`);
    }
    const stage = stageByKey(deps.stages, stageRun.stage_key);
    const hashes = await packageVersionHashes(tx, stageRun, stage, versionIds);
    await assertNoBlockingQuestions(tx, stageRunId);
    await supersedeOpenPackage(tx, deps, actor, { initiative, stageRun, stage });

    const { rows } = await tx.query(
      `INSERT INTO review_packages (stage_run_id, package_hash, submitted_by, submitted_at, status)
       VALUES ($1, $2, $3, $4, 'open') RETURNING id, package_hash`,
      [stageRunId, packageHash(hashes), actor.id, deps.now()],
    );
    const pkg = rows[0];
    for (const versionId of versionIds) {
      await tx.query(
        'INSERT INTO review_package_versions (package_id, version_id) VALUES ($1, $2)',
        [pkg.id, versionId],
      );
    }
    audit(
      tx,
      deps,
      actor,
      'package.submitted',
      { type: 'review_package', id: pkg.id },
      initiative.id,
      {
        stageRunId,
        packageHash: pkg.package_hash,
        versionIds,
      },
    );
    const gateRunId = await advance(tx, deps, actor, {
      initiative,
      stageRun,
      stage,
      packageId: pkg.id,
    });
    return { id: pkg.id, packageHash: pkg.package_hash, versionIds, gateRunId };
  });
}

/**
 * Check the versions are this stage run's outputs, one per artifact, and return their hashes.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {StageRunRow} stageRun Stage run.
 * @param {StageDefinition} stage Its definition.
 * @param {string[]} versionIds Versions to submit.
 * @returns {Promise<string[]>} Their content hashes.
 * @throws {InvalidPackageError} When the list is empty, repeats an artifact or strays outside.
 */
async function packageVersionHashes(tx, stageRun, stage, versionIds) {
  if (versionIds.length === 0) {
    throw new InvalidPackageError('A package needs at least one version');
  }
  const { rows } = await tx.query(
    `SELECT v.id, v.content_hash, a.id AS artifact_id FROM artifact_versions v
     JOIN artifacts a ON a.id = v.artifact_id
     WHERE v.id = ANY($1) AND a.stage_run_id = $2 AND a.type = ANY($3)`,
    [versionIds, stageRun.id, stage.outputs],
  );
  if (rows.length !== versionIds.length) {
    throw new InvalidPackageError("Every version must be one of this stage run's outputs");
  }
  if (new Set(rows.map((row) => row.artifact_id)).size !== rows.length) {
    throw new InvalidPackageError('A package holds at most one version of each artifact');
  }
  return rows.map((row) => row.content_hash);
}

/**
 * Refuse submission while any blocking question on this stage run's versions is open.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {string} stageRunId Stage run ID.
 * @returns {Promise<void>}
 * @throws {BlockingQuestionsError} When one is open.
 */
async function assertNoBlockingQuestions(tx, stageRunId) {
  const { rows } = await tx.query(
    `SELECT count(*)::int AS open FROM open_questions q
     JOIN artifact_versions v ON v.id = q.version_id
     JOIN artifacts a ON a.id = v.artifact_id
     WHERE a.stage_run_id = $1 AND q.blocking AND q.status = 'open'`,
    [stageRunId],
  );
  if (rows[0].open > 0) {
    throw new BlockingQuestionsError(
      `${rows[0].open} blocking open question(s) must be answered before submitting`,
    );
  }
}

/**
 * Supersede the stage run's open package, if any. Its waiting gate is cancelled and the stage's
 * steps restart from the first (core-design section 5), so the new package goes through every
 * gate again, not only the one that happened to be waiting.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who is resubmitting.
 * @param {{ initiative: InitiativeRow, stageRun: StageRunRow, stage: StageDefinition }} context
 *   Where the resubmission happens.
 * @returns {Promise<void>}
 */
async function supersedeOpenPackage(tx, deps, actor, { initiative, stageRun, stage }) {
  const { rows } = await tx.query(
    `UPDATE review_packages SET status = 'superseded'
     WHERE stage_run_id = $1 AND status = 'open' RETURNING id`,
    [stageRun.id],
  );
  if (rows.length === 0) {
    return;
  }
  const supersededId = rows[0].id;
  const now = deps.now();
  await tx.query(
    `UPDATE gate_runs SET state = 'cancelled', closed_at = $2
     WHERE package_id = $1 AND state = 'open'`,
    [supersededId, now],
  );
  const [{ cycle }] = await currentCycleSteps(tx, stageRun.id);
  await tx.query(
    `UPDATE step_runs SET state = 'skipped', completed_at = $3
     WHERE stage_run_id = $1 AND cycle = $2 AND state IN ('pending', 'running', 'waiting')`,
    [stageRun.id, cycle, now],
  );
  await insertCycle(tx, deps, {
    stageRunId: stageRun.id,
    stage,
    flags: initiative.flags,
    cycle: cycle + 1,
  });
  const entity = { type: 'review_package', id: supersededId };
  audit(tx, deps, actor, 'package.superseded', entity, initiative.id, { stageRunId: stageRun.id });
  audit(
    tx,
    deps,
    actor,
    'stage_run.restarted',
    { type: 'stage_run', id: stageRun.id },
    initiative.id,
    {
      cycle: cycle + 1,
      reason: 'resubmitted',
    },
  );
}

/**
 * Move the stage on with the new package: complete the running work step through `nextMove`,
 * which opens the first gate.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {Actor} actor Who submitted.
 * @param {{ initiative: InitiativeRow, stageRun: StageRunRow, stage: StageDefinition, packageId: string }} context
 *   Where the submission happens.
 * @returns {Promise<string | null>} The gate run now open, if any.
 * @throws {InvalidTransitionError} When no work step is waiting for a package.
 */
async function advance(tx, deps, actor, context) {
  const { initiative, stageRun, stage, packageId } = context;
  const steps = await currentCycleSteps(tx, stageRun.id);
  const running = steps.find((run) => run.state === 'running' && run.step_type === 'work');
  if (running === undefined) {
    throw new InvalidTransitionError('No work step in this stage run is waiting for a package');
  }
  const move = nextMove(stage, { flags: initiative.flags }, running.step_key, { kind: 'done' });
  await applyMove(
    tx,
    deps,
    actor,
    { initiative, stageRun, stage, stepRun: running, packageId },
    move,
  );
  return openGateFor(tx, stageRun.id, packageId);
}

/**
 * The gate run left open on a package, if any.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {string} stageRunId Stage run ID.
 * @param {string} packageId Package ID.
 * @returns {Promise<string | null>} Gate run ID.
 */
async function openGateFor(tx, stageRunId, packageId) {
  const { rows } = await tx.query(
    `SELECT g.id FROM gate_runs g JOIN step_runs s ON s.id = g.step_run_id
     WHERE s.stage_run_id = $1 AND g.package_id = $2 AND g.state = 'open'`,
    [stageRunId, packageId],
  );
  return rows[0]?.id ?? null;
}
