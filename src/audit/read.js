// @ts-check

/** @import { AuditRecord } from './chain.js' */
/** @import { Queryable } from '../db/index.js' */

/**
 * @typedef {AuditRecord & { seq: string, prevHash: string, hash: string }} StoredAuditEvent
 */

/**
 * @typedef {object} AuditRow
 * @property {string | number} seq Sequence number (bigint arrives as a string).
 * @property {string} id Event ID.
 * @property {Date} occurred_at When it happened.
 * @property {'user' | 'agent' | 'system'} actor_type Who acted.
 * @property {string} actor_id Their ID.
 * @property {string} action What happened.
 * @property {string} entity_type Kind of record.
 * @property {string} entity_id Its ID.
 * @property {string | null} initiative_id Initiative, if any.
 * @property {Record<string, unknown>} data Details.
 * @property {string} prev_hash Previous hash.
 * @property {string} hash This event's hash.
 */

const SELECT_ALL = `SELECT seq, id, occurred_at, actor_type, actor_id, action, entity_type,
  entity_id, initiative_id, data, prev_hash, hash FROM audit_events ORDER BY seq`;
const SELECT_FOR_INITIATIVE = `SELECT seq, id, occurred_at, actor_type, actor_id, action,
  entity_type, entity_id, initiative_id, data, prev_hash, hash FROM audit_events
  WHERE initiative_id = $1 ORDER BY seq`;
/** One batch of the chain after a given sequence number, for verification. */
export const SELECT_BATCH_AFTER = `SELECT seq, id, occurred_at, actor_type, actor_id, action,
  entity_type, entity_id, initiative_id, data, prev_hash, hash FROM audit_events
  WHERE seq > $1 ORDER BY seq LIMIT $2`;

/**
 * Map an audit_events row to a stored event.
 * @param {AuditRow} row Database row.
 * @returns {StoredAuditEvent} The event.
 */
export function toStoredEvent(row) {
  return {
    seq: String(row.seq),
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    initiativeId: row.initiative_id,
    data: row.data,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

/**
 * List audit events in chain order, optionally for one Initiative (its timeline).
 * @param {Queryable} db Pool or transaction.
 * @param {{ initiativeId?: string }} [filter] Initiative to filter by.
 * @returns {Promise<StoredAuditEvent[]>} Events, oldest first.
 */
export async function listAuditEvents(db, { initiativeId } = {}) {
  const { rows } =
    initiativeId === undefined
      ? await db.query(SELECT_ALL)
      : await db.query(SELECT_FOR_INITIATIVE, [initiativeId]);
  return /** @type {AuditRow[]} */ (rows).map(toStoredEvent);
}
