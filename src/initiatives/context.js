// @ts-check
import { appendAuditEvent } from '../audit/index.js';
import { withTransaction } from '../db/index.js';
import { NotFoundError } from '../errors/index.js';

/** @import { StageDefinition } from '../stages/index.js' */
/** @import { ContentStore } from '../content/index.js' */

/**
 * @typedef {object} Actor
 * @property {'user' | 'agent'} type Person or agent service identity.
 * @property {string} id Their ID.
 */

/**
 * @typedef {object} WorkflowDeps
 * @property {import('pg').Pool} pool Connection pool.
 * @property {ReadonlyArray<StageDefinition>} stages Loaded, validated stage configuration.
 * @property {ContentStore} contentStore Where version content lives.
 * @property {() => Date} now Clock.
 */

/**
 * @typedef {object} InitiativeRow
 * @property {string} id Initiative ID.
 * @property {string} key Readable key, e.g. INI-0001.
 * @property {string} status Initiative status.
 * @property {string} current_stage_key Stage the Initiative is at.
 * @property {Record<string, boolean>} flags Initiative flags.
 */

/** Audit events waiting for their transaction to finish, per transaction connection. */
const pendingAudit = new WeakMap();

/**
 * Run workflow work in one transaction. Audit events recorded with `audit()` are buffered and
 * appended together at the end, just before commit, so the audit chain head is always the last
 * lock a workflow transaction takes (ADR 0004) and is held only briefly.
 * @template T
 * @param {WorkflowDeps} deps Dependencies.
 * @param {(tx: import('pg').PoolClient) => Promise<T>} work The workflow change.
 * @returns {Promise<T>} What `work` returned.
 */
export function workflowTransaction(deps, work) {
  return withTransaction(deps.pool, async (tx) => {
    /** @type {{ event: import('../audit/index.js').AuditEventInput, at: Date }[]} */
    const events = [];
    pendingAudit.set(tx, events);
    try {
      const result = await work(tx);
      for (const { event, at } of events) {
        await appendAuditEvent(tx, event, { now: () => at });
      }
      return result;
    } finally {
      pendingAudit.delete(tx);
    }
  });
}

/**
 * Record an audit event for a workflow change. It is appended when the surrounding
 * `workflowTransaction` finishes, and only if it commits.
 * @param {import('pg').PoolClient} tx Transaction from `workflowTransaction`.
 * @param {WorkflowDeps} deps Dependencies (for the clock).
 * @param {Actor} actor Who acted.
 * @param {string} action What happened, e.g. `package.submitted`.
 * @param {{ type: string, id: string }} entity Record changed.
 * @param {string} initiativeId Initiative it belongs to.
 * @param {Record<string, unknown>} [data] Details.
 * @returns {void}
 * @throws {Error} When called outside a workflow transaction (a programming error).
 */
export function audit(tx, deps, actor, action, entity, initiativeId, data = {}) {
  const events = pendingAudit.get(tx);
  if (events === undefined) {
    throw new Error('audit() must be called inside workflowTransaction()');
  }
  events.push({
    event: {
      actorType: actor.type,
      actorId: actor.id,
      action,
      entityType: entity.type,
      entityId: entity.id,
      initiativeId,
      data,
    },
    at: deps.now(),
  });
}

/**
 * Lock an Initiative row for the rest of the transaction. Every service that changes workflow
 * state takes this lock first, so changes to one Initiative are serialised and locks are always
 * taken in the same order.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {string} initiativeId Initiative ID.
 * @returns {Promise<InitiativeRow>} The locked row.
 * @throws {NotFoundError} When there is no such Initiative.
 */
export async function lockInitiative(tx, initiativeId) {
  const { rows } = await tx.query(
    `SELECT id, key, status, current_stage_key, flags FROM initiatives WHERE id = $1 FOR UPDATE`,
    [initiativeId],
  );
  if (rows.length === 0) {
    throw new NotFoundError('Initiative not found');
  }
  return rows[0];
}

/**
 * Change an Initiative's status and current stage.
 * @param {import('pg').PoolClient} tx Transaction.
 * @param {WorkflowDeps} deps Dependencies (for the clock).
 * @param {string} initiativeId Initiative ID.
 * @param {{ status: string, currentStageKey: string }} change New status and stage.
 * @returns {Promise<void>}
 */
export async function updateInitiative(tx, deps, initiativeId, { status, currentStageKey }) {
  await tx.query(
    'UPDATE initiatives SET status = $2, current_stage_key = $3, updated_at = $4 WHERE id = $1',
    [initiativeId, status, currentStageKey, deps.now()],
  );
}
