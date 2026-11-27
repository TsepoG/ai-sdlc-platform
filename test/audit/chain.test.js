// @ts-check
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendAuditEvent,
  canonicalJson,
  GENESIS_HASH,
  listAuditEvents,
  verifyAuditChain,
} from '../../src/audit/index.js';
import { withTransaction } from '../../src/db/index.js';
import { createTestDatabase } from '../db/test-database.js';

/** @type {import('../db/test-database.js').TestDatabase} */
let db;

beforeEach(async () => {
  db = await createTestDatabase();
});

afterEach(async () => {
  await db.close();
});

const INITIATIVE = '11111111-1111-4111-8111-111111111111';

/**
 * A synthetic audit event.
 * @param {string} action Action name.
 * @param {Partial<import('../../src/audit/index.js').AuditEventInput>} [overrides] Fields to replace.
 * @returns {import('../../src/audit/index.js').AuditEventInput} Event.
 */
function event(action, overrides = {}) {
  return {
    actorType: 'user',
    actorId: 'u-1',
    action,
    entityType: 'initiative',
    entityId: INITIATIVE,
    initiativeId: INITIATIVE,
    data: { note: action },
    ...overrides,
  };
}

/**
 * Append events one transaction each.
 * @param {string[]} actions Actions, in order.
 * @returns {Promise<void>}
 */
async function appendAll(actions) {
  for (const action of actions) {
    await withTransaction(db.pool, (tx) => appendAuditEvent(tx, event(action)));
  }
}

/**
 * Run SQL with the insert-only trigger off, as a table owner (an attacker) could.
 * @param {string} sql Tampering statement.
 * @param {unknown[]} params Bind parameters.
 * @returns {Promise<void>}
 */
async function tamper(sql, params) {
  await db.pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_insert_only');
  await db.pool.query(sql, params);
  await db.pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_insert_only');
}

describe('appendAuditEvent', () => {
  it('chains the first event to the genesis hash', async () => {
    const appended = await withTransaction(db.pool, (tx) => appendAuditEvent(tx, event('a')));

    const [row] = await listAuditEvents(db.pool);
    expect(row.prevHash).toBe(GENESIS_HASH);
    expect(row.hash).toBe(appended.hash);
  });

  it('hashes the previous hash plus the canonical JSON of the event', async () => {
    const at = new Date('2026-12-07T08:00:00.123Z');

    await withTransaction(db.pool, (tx) =>
      appendAuditEvent(tx, event('a'), { now: () => at, newId: () => INITIATIVE }),
    );

    const [row] = await listAuditEvents(db.pool);
    const canonical = canonicalJson({
      id: INITIATIVE,
      occurredAt: at.toISOString(),
      actorType: 'user',
      actorId: 'u-1',
      action: 'a',
      entityType: 'initiative',
      entityId: INITIATIVE,
      initiativeId: INITIATIVE,
      data: { note: 'a' },
    });
    const expected = createHash('sha256')
      .update(GENESIS_HASH + canonical, 'utf8')
      .digest('hex');
    expect(row.hash).toBe(expected);
  });

  it('links each event to the one before', async () => {
    await appendAll(['a', 'b', 'c']);

    const rows = await listAuditEvents(db.pool);
    expect(rows.map((row) => row.action)).toEqual(['a', 'b', 'c']);
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(rows[2].prevHash).toBe(rows[1].hash);
  });

  it('stores events without an initiative or data', async () => {
    await withTransaction(db.pool, (tx) =>
      appendAuditEvent(tx, {
        actorType: 'system',
        actorId: 'worker',
        action: 'x',
        entityType: 'job',
        entityId: 'j',
      }),
    );

    const [row] = await listAuditEvents(db.pool);
    expect(row).toMatchObject({ initiativeId: null, data: {} });
    expect((await verifyAuditChain(db.pool)).ok).toBe(true);
  });

  it('writes nothing when the surrounding transaction rolls back', async () => {
    await withTransaction(db.pool, async (tx) => {
      await appendAuditEvent(tx, event('a'));
      throw new Error('abort');
    }).catch(() => undefined);

    expect(await listAuditEvents(db.pool)).toEqual([]);
    expect((await verifyAuditChain(db.pool)).ok).toBe(true);
  });

  it('never forks the chain under concurrent appends', async () => {
    const other = db.newPool();
    const appends = Array.from({ length: 12 }, (_, index) =>
      withTransaction(index % 2 === 0 ? db.pool : other, (tx) =>
        appendAuditEvent(tx, event(`e${index}`)),
      ),
    );

    await Promise.all(appends);

    const result = await verifyAuditChain(db.pool);
    expect(result).toEqual({ ok: true, checked: 12 });
  });
});

describe('listAuditEvents', () => {
  it('filters by initiative, in order', async () => {
    await appendAll(['a']);
    await withTransaction(db.pool, (tx) =>
      appendAuditEvent(
        tx,
        event('other', { initiativeId: '22222222-2222-4222-8222-222222222222' }),
      ),
    );
    await appendAll(['b']);

    const rows = await listAuditEvents(db.pool, { initiativeId: INITIATIVE });
    expect(rows.map((row) => row.action)).toEqual(['a', 'b']);
  });
});

describe('verifyAuditChain', () => {
  it('passes an empty chain', async () => {
    expect(await verifyAuditChain(db.pool)).toEqual({ ok: true, checked: 0 });
  });

  it('passes an intact chain, checking every event across batches', async () => {
    await appendAll(['a', 'b', 'c', 'd', 'e']);

    expect(await verifyAuditChain(db.pool, { batchSize: 2 })).toEqual({ ok: true, checked: 5 });
  });

  it('never reports a false break while appends are committing', async () => {
    const other = db.newPool();
    const appends = Array.from({ length: 30 }, (_, index) =>
      withTransaction(other, (tx) => appendAuditEvent(tx, event(`concurrent${index}`))),
    );
    const verifications = Array.from({ length: 15 }, () =>
      verifyAuditChain(db.pool, { batchSize: 3 }),
    );

    const results = await Promise.all(verifications);
    await Promise.all(appends);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(await verifyAuditChain(db.pool)).toEqual({ ok: true, checked: 30 });
  });

  it('reports an edited event as the first break', async () => {
    await appendAll(['a', 'b', 'c']);
    const [, second] = await listAuditEvents(db.pool);
    await tamper(`UPDATE audit_events SET data = '{"note":"forged"}' WHERE seq = $1`, [second.seq]);

    const result = await verifyAuditChain(db.pool);

    expect(result).toMatchObject({
      ok: false,
      firstBreak: { seq: second.seq, id: second.id, reason: 'hash_mismatch' },
    });
  });

  it('reports a deleted event at the next link', async () => {
    await appendAll(['a', 'b', 'c']);
    const [, second, third] = await listAuditEvents(db.pool);
    await tamper('DELETE FROM audit_events WHERE seq = $1', [second.seq]);

    const result = await verifyAuditChain(db.pool);

    expect(result).toMatchObject({
      ok: false,
      firstBreak: { seq: third.seq, reason: 'broken_link' },
    });
  });

  it('reports a truncated tail through the chain head', async () => {
    await appendAll(['a', 'b']);
    const [, last] = await listAuditEvents(db.pool);
    await tamper('DELETE FROM audit_events WHERE seq = $1', [last.seq]);

    const result = await verifyAuditChain(db.pool);

    expect(result).toMatchObject({ ok: false, firstBreak: { reason: 'head_mismatch' } });
  });
});

describe('verifyAuditChain errors', () => {
  it('rolls back and rethrows when the chain cannot be read', async () => {
    await db.pool.query('DROP TABLE audit_chain_head');

    await expect(verifyAuditChain(db.pool)).rejects.toThrow(/audit_chain_head/);
    expect(db.pool.totalCount).toBe(db.pool.idleCount);
  });
});
