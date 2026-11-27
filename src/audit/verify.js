// @ts-check
import { chainHash, GENESIS_HASH } from './chain.js';
import { SELECT_BATCH_AFTER, toStoredEvent } from './read.js';

/** @import { AuditRow } from './read.js' */
/** @import { Queryable } from '../db/index.js' */

const DEFAULT_BATCH_SIZE = 500;

/**
 * @typedef {object} ChainBreak
 * @property {string} seq Sequence number where the chain stops verifying.
 * @property {string | null} id Event ID there (null when the break is in the chain head).
 * @property {'broken_link' | 'hash_mismatch' | 'head_mismatch'} reason `broken_link`: the event
 *   doesn't point at the one before it (one was removed or reordered); `hash_mismatch`: the
 *   event was changed; `head_mismatch`: events after the last one were removed.
 */

/**
 * @typedef {{ ok: true, checked: number } | { ok: false, checked: number, firstBreak: ChainBreak }} ChainVerification
 */

/**
 * Recompute the whole audit chain and report the first place it no longer verifies.
 * @param {Queryable} db Pool or transaction.
 * @param {{ batchSize?: number }} [options] Events read per query.
 * @returns {Promise<ChainVerification>} Whether the chain verifies, and how many events were checked.
 */
export async function verifyAuditChain(db, { batchSize = DEFAULT_BATCH_SIZE } = {}) {
  let expectedPrev = GENESIS_HASH;
  let lastSeq = '0';
  let checked = 0;
  for (;;) {
    const { rows } = await db.query(SELECT_BATCH_AFTER, [lastSeq, batchSize]);
    for (const event of /** @type {AuditRow[]} */ (rows).map(toStoredEvent)) {
      if (event.prevHash !== expectedPrev) {
        return broken(checked, event.seq, event.id, 'broken_link');
      }
      if (chainHash(event.prevHash, event) !== event.hash) {
        return broken(checked, event.seq, event.id, 'hash_mismatch');
      }
      expectedPrev = event.hash;
      lastSeq = event.seq;
      checked += 1;
    }
    if (rows.length < batchSize) {
      break;
    }
  }
  const { rows: heads } = await db.query('SELECT last_seq, last_hash FROM audit_chain_head');
  const head = /** @type {{ last_seq: string, last_hash: string }} */ (heads[0]);
  if (String(head.last_seq) !== lastSeq || head.last_hash !== expectedPrev) {
    return broken(checked, String(head.last_seq), null, 'head_mismatch');
  }
  return { ok: true, checked };
}

/**
 * Build a failed verification result.
 * @param {number} checked Events that verified before the break.
 * @param {string} seq Where the break is.
 * @param {string | null} id Event ID there, if any.
 * @param {ChainBreak['reason']} reason What is wrong.
 * @returns {ChainVerification} The result.
 */
function broken(checked, seq, id, reason) {
  return { ok: false, checked, firstBreak: { seq, id, reason } };
}
