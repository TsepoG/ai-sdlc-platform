// @ts-check
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

/** The `prevHash` of the first event: 64 zeros. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * @typedef {object} AuditEventInput
 * @property {'user' | 'agent' | 'system'} actorType Who acted.
 * @property {string} actorId Their ID.
 * @property {string} action What happened, e.g. `decision.recorded`.
 * @property {string} entityType Kind of record changed.
 * @property {string} entityId Its ID.
 * @property {string | null} [initiativeId] Initiative it belongs to, if any.
 * @property {Record<string, unknown>} [data] Details (plain data only).
 */

/**
 * @typedef {object} AuditRecord
 * @property {string} id Event ID.
 * @property {string} occurredAt ISO-8601 timestamp, millisecond precision.
 * @property {'user' | 'agent' | 'system'} actorType Who acted.
 * @property {string} actorId Their ID.
 * @property {string} action What happened.
 * @property {string} entityType Kind of record changed.
 * @property {string} entityId Its ID.
 * @property {string | null} initiativeId Initiative it belongs to, or null.
 * @property {Record<string, unknown>} data Details.
 */

/**
 * The hash of an event: SHA-256 over the previous hash followed by the canonical JSON of every
 * recorded field. Changing any field, or the order of events, changes every later hash.
 * @param {string} prevHash Hash of the previous event (or the genesis hash).
 * @param {AuditRecord} record Event fields.
 * @returns {string} SHA-256 hex.
 */
export function chainHash(prevHash, record) {
  const canonical = canonicalJson({
    id: record.id,
    occurredAt: record.occurredAt,
    actorType: record.actorType,
    actorId: record.actorId,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    initiativeId: record.initiativeId,
    data: record.data,
  });
  return createHash('sha256')
    .update(prevHash + canonical, 'utf8')
    .digest('hex');
}

/**
 * Append an event to the audit chain inside the caller's transaction. Locking the chain-head
 * row serialises appends, so two transactions can never chain onto the same previous event.
 * @param {import('pg').PoolClient} tx Connection inside a transaction.
 * @param {AuditEventInput} event What happened.
 * @param {{ now?: () => Date, newId?: () => string }} [deps] Clock and ID source (for tests).
 * @returns {Promise<{ id: string, seq: string, hash: string }>} The stored event's ID, sequence
 *   number and hash.
 */
export async function appendAuditEvent(
  tx,
  event,
  { now = () => new Date(), newId = randomUUID } = {},
) {
  const { rows: heads } = await tx.query(
    'SELECT last_hash FROM audit_chain_head WHERE id FOR UPDATE',
  );
  const prevHash = heads[0].last_hash;
  /** @type {AuditRecord} */
  const record = {
    id: newId(),
    occurredAt: now().toISOString(),
    actorType: event.actorType,
    actorId: event.actorId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    initiativeId: event.initiativeId ?? null,
    data: event.data ?? {},
  };
  const hash = chainHash(prevHash, record);
  const { rows } = await tx.query(
    `INSERT INTO audit_events (id, occurred_at, actor_type, actor_id, action, entity_type,
       entity_id, initiative_id, data, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING seq`,
    [
      record.id,
      record.occurredAt,
      record.actorType,
      record.actorId,
      record.action,
      record.entityType,
      record.entityId,
      record.initiativeId,
      record.data,
      prevHash,
      hash,
    ],
  );
  const seq = String(rows[0].seq);
  await tx.query('UPDATE audit_chain_head SET last_seq = $1, last_hash = $2 WHERE id', [seq, hash]);
  return { id: record.id, seq, hash };
}
