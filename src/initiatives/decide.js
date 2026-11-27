// @ts-check
import { GateNotOpenError, InvalidTransitionError, NotFoundError } from '../errors/index.js';
import { assertCanDecide, assertCurrentPackage, nextMove } from '../workflow/index.js';
import { audit, lockInitiative, workflowTransaction } from './context.js';
import { applyMove } from './moves.js';
import { stageByKey, toStepOutcome } from './plan.js';
import { lockStageRun } from './stage-runs.js';

/** @import { Actor, WorkflowDeps } from './context.js' */
/** @import { DecisionInput } from './plan.js' */
/** @import { Move } from '../workflow/index.js' */
/** @import { StageRunRow, StepRunRow } from './stage-runs.js' */

/**
 * @typedef {DecisionInput & { packageHash: string, feedback?: string }} DecideInput
 *   The decision, the package hash the reviewer saw, and optional feedback.
 */

/**
 * @typedef {object} DecisionResult
 * @property {string} decisionId Recorded decision.
 * @property {Move} move Where the workflow went.
 */

/**
 * Decide a gate. Refuses a stale package hash (409) and a reviewer without the gate's role or
 * who authored the package (403) before writing anything; then records the decision and applies
 * the Phase 01 `nextMove` for it, with audit events, in one transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} gateRunId Gate run to decide.
 * @param {DecideInput} input Outcome, package hash, rework target and feedback.
 * @param {Actor} actor Reviewer.
 * @param {ReadonlyArray<string>} roles Reviewer's roles.
 * @returns {Promise<DecisionResult>} The decision and the move it caused.
 * @throws {NotFoundError} When the gate run does not exist.
 * @throws {GateNotOpenError} When the gate was already decided or cancelled (409).
 * @throws {import('../errors/index.js').StalePackageError} When the hash is not the package's (409).
 * @throws {import('../errors/index.js').NotAuthorisedError} Without the gate's role (403).
 * @throws {import('../errors/index.js').SeparationOfDutiesError} For a package author (403).
 * @throws {InvalidTransitionError} When the stage run is blocked or the rework target not allowed.
 */
export async function decide(deps, gateRunId, input, actor, roles) {
  const owner = await deps.pool.query(
    `SELECT r.initiative_id FROM gate_runs g JOIN step_runs s ON s.id = g.step_run_id
     JOIN stage_runs r ON r.id = s.stage_run_id WHERE g.id = $1`,
    [gateRunId],
  );
  if (owner.rows.length === 0) {
    throw new NotFoundError('Gate run not found');
  }
  return workflowTransaction(deps, async (tx) => {
    const initiative = await lockInitiative(tx, owner.rows[0].initiative_id);
    const gate = await lockOpenGate(tx, gateRunId);
    assertCurrentPackage(gate.package_hash, input.packageHash);
    assertCanDecide({
      reviewerId: actor.id,
      reviewerRoles: roles,
      approverRole: gate.approver_role,
      packageAuthorIds: await packageAuthors(tx, gate.package_id),
    });
    const stageRun = /** @type {StageRunRow} */ (await lockStageRun(tx, gate.stage_run_id));
    if (stageRun.state !== 'active') {
      throw new InvalidTransitionError(`Stage run is ${stageRun.state}; it must be re-reviewed`);
    }
    const stage = stageByKey(deps.stages, stageRun.stage_key);
    const move = nextMove(stage, { flags: initiative.flags }, gate.step_key, toStepOutcome(input));

    const decisionId = await recordDecision(tx, deps, gateRunId, input, actor);
    audit(
      tx,
      deps,
      actor,
      'decision.recorded',
      { type: 'decision', id: decisionId },
      initiative.id,
      {
        gateRunId,
        outcome: input.outcome,
        reworkTarget: input.reworkTarget,
        packageHash: input.packageHash,
      },
    );
    /** @type {StepRunRow} */
    const stepRun = {
      id: gate.step_run_id,
      step_key: gate.step_key,
      step_type: 'gate',
      cycle: gate.cycle,
      state: 'waiting',
      package_id: gate.package_id,
    };
    await applyMove(
      tx,
      deps,
      actor,
      { initiative, stageRun, stage, stepRun, packageId: gate.package_id },
      move,
    );
    return { decisionId, move };
  });
}

/**
 * @typedef {object} OpenGate
 * @property {string} step_run_id Gate's step run.
 * @property {string} step_key Gate step key.
 * @property {number} cycle Cycle of the step run.
 * @property {string} stage_run_id Stage run.
 * @property {string} package_id Package under review.
 * @property {string} package_hash Its hash.
 * @property {string} approver_role Role needed to decide.
 */

/**
 * Lock a gate run and check it is still open.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {string} gateRunId Gate run ID.
 * @returns {Promise<OpenGate>} The gate with its step and package.
 * @throws {GateNotOpenError} When it is no longer open.
 */
async function lockOpenGate(tx, gateRunId) {
  const { rows } = await tx.query(
    `SELECT g.state, g.step_run_id, g.package_id, g.approver_role, s.step_key, s.cycle,
       s.stage_run_id, p.package_hash
     FROM gate_runs g JOIN step_runs s ON s.id = g.step_run_id
     JOIN review_packages p ON p.id = g.package_id
     WHERE g.id = $1 FOR UPDATE OF g`,
    [gateRunId],
  );
  if (rows[0].state !== 'open') {
    throw new GateNotOpenError(`This gate is ${rows[0].state}; it cannot be decided again`);
  }
  return rows[0];
}

/**
 * Everyone who authored or edited the package (separation of duties): who created each version
 * in it, who submitted it, and who created any version those versions derive from, following
 * `source_version_ids` back through every generation.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {string} packageId Package ID.
 * @returns {Promise<string[]>} Author IDs.
 */
async function packageAuthors(tx, packageId) {
  const { rows } = await tx.query(
    `WITH RECURSIVE lineage(id) AS (
       SELECT version_id FROM review_package_versions WHERE package_id = $1
       UNION
       SELECT source.id FROM lineage
       JOIN artifact_versions v ON v.id = lineage.id
       JOIN artifact_versions source ON source.id = ANY(v.source_version_ids)
     )
     SELECT v.created_by_id AS author FROM lineage JOIN artifact_versions v ON v.id = lineage.id
     UNION
     SELECT submitted_by FROM review_packages WHERE id = $1`,
    [packageId],
  );
  return rows.map((row) => row.author);
}

/**
 * Insert the decision and close its gate run.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies.
 * @param {string} gateRunId Gate run ID.
 * @param {DecideInput} input The decision.
 * @param {Actor} actor Reviewer.
 * @returns {Promise<string>} Decision ID.
 */
async function recordDecision(tx, deps, gateRunId, input, actor) {
  const now = deps.now();
  const { rows } = await tx.query(
    `INSERT INTO decisions (gate_run_id, package_hash, reviewer_id, outcome, rework_target,
       feedback, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      gateRunId,
      input.packageHash,
      actor.id,
      input.outcome,
      input.reworkTarget ?? null,
      input.feedback ?? null,
      now,
    ],
  );
  await tx.query(`UPDATE gate_runs SET state = 'decided', closed_at = $2 WHERE id = $1`, [
    gateRunId,
    now,
  ]);
  return rows[0].id;
}
