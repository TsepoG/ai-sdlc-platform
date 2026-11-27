// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendAuditEvent, listAuditEvents, verifyAuditChain } from '../../src/audit/index.js';
import { withTransaction } from '../../src/db/index.js';
import { audit, workflowTransaction } from '../../src/initiatives/context.js';
import { createTestDatabase } from '../db/test-database.js';

const INITIATIVE = '11111111-1111-4111-8111-111111111111';
/** @type {import('../../src/initiatives/index.js').Actor} */
const ACTOR = { type: 'user', id: 'u-1' };

/** @type {import('../db/test-database.js').TestDatabase} */
let db;
/** @type {import('../../src/initiatives/index.js').WorkflowDeps} */
let deps;

beforeEach(async () => {
  db = await createTestDatabase();
  deps = {
    pool: db.pool,
    stages: [],
    contentStore: /** @type {import('../../src/content/index.js').ContentStore} */ (
      /** @type {unknown} */ ({})
    ),
    now: () => new Date(),
  };
});

afterEach(async () => {
  await db.close();
});

describe('workflowTransaction', () => {
  it('appends buffered audit events only at the end, so the chain head is locked last', async () => {
    const other = db.newPool();

    await workflowTransaction(deps, async (tx) => {
      audit(tx, deps, ACTOR, 'workflow.first', { type: 'test', id: 'a' }, INITIATIVE);
      // A concurrent append must not wait for this transaction: the head is not locked yet.
      await withTransaction(other, (otherTx) =>
        appendAuditEvent(otherTx, {
          actorType: 'system',
          actorId: 'other',
          action: 'other.event',
          entityType: 'test',
          entityId: 'b',
        }),
      );
      audit(tx, deps, ACTOR, 'workflow.second', { type: 'test', id: 'c' }, INITIATIVE);
    });

    const actions = (await listAuditEvents(db.pool)).map((event) => event.action);
    expect(actions).toEqual(['other.event', 'workflow.first', 'workflow.second']);
    expect((await verifyAuditChain(db.pool)).ok).toBe(true);
  });

  it('appends nothing when the work fails', async () => {
    await workflowTransaction(deps, async (tx) => {
      audit(tx, deps, ACTOR, 'workflow.first', { type: 'test', id: 'a' }, INITIATIVE);
      throw new Error('abort');
    }).catch(() => undefined);

    expect(await listAuditEvents(db.pool)).toEqual([]);
  });

  it('refuses audit() outside a workflow transaction', async () => {
    await withTransaction(db.pool, async (tx) => {
      expect(() => audit(tx, deps, ACTOR, 'x', { type: 'test', id: 'a' }, INITIATIVE)).toThrow(
        /workflowTransaction/,
      );
    });
  });
});
