// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from './test-database.js';

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

/** @type {import('./test-database.js').TestDatabase} */
let db;
/** @type {Record<string, string>} */
const ids = {};

/**
 * Run one statement and return the first row.
 * @param {string} sql SQL text.
 * @param {unknown[]} [params] Parameters.
 * @returns {Promise<Record<string, unknown>>} First row.
 */
async function one(sql, params = []) {
  const { rows } = await db.pool.query(sql, params);
  return rows[0];
}

/**
 * Insert a row and return its id.
 * @param {string} sql INSERT … RETURNING id.
 * @param {unknown[]} [params] Parameters.
 * @returns {Promise<string>} The new id.
 */
async function insertId(sql, params = []) {
  return String((await one(sql, params)).id);
}

beforeAll(async () => {
  db = await createTestDatabase();
  ids.initiative = await insertId(
    `INSERT INTO initiatives (title, requester_id, owner_id, status, current_stage_key)
       VALUES ('Synthetic', 'u-req', 'u-own', 'active', 'brief') RETURNING id`,
  );
  ids.stageRun = await insertId(
    `INSERT INTO stage_runs (initiative_id, stage_key, attempt, state, config_version)
       VALUES ($1, 'brief', 1, 'active', $2) RETURNING id`,
    [ids.initiative, HASH],
  );
  ids.artifact = await insertId(
    `INSERT INTO artifacts (initiative_id, stage_run_id, type, title)
       VALUES ($1, $2, 'epics', 'Epics') RETURNING id`,
    [ids.initiative, ids.stageRun],
  );
  ids.version = await insertId(
    `INSERT INTO artifact_versions (artifact_id, number, content_key, content_hash, format,
         created_by_type, created_by_id)
       VALUES ($1, 1, $2, $3, 'markdown', 'user', 'u-author') RETURNING id`,
    [ids.artifact, `sha256/${HASH}`, HASH],
  );
  ids.package = await insertId(
    `INSERT INTO review_packages (stage_run_id, package_hash, submitted_by, status)
       VALUES ($1, $2, 'u-author', 'open') RETURNING id`,
    [ids.stageRun, HASH],
  );
  await db.pool.query(
    'INSERT INTO review_package_versions (package_id, version_id) VALUES ($1, $2)',
    [ids.package, ids.version],
  );
  ids.stepRun = await insertId(
    `INSERT INTO step_runs (stage_run_id, step_key, step_type, position, cycle, state, package_id)
       VALUES ($1, 'epic-approval', 'gate', 1, 1, 'waiting', $2) RETURNING id`,
    [ids.stageRun, ids.package],
  );
  ids.gateRun = await insertId(
    `INSERT INTO gate_runs (step_run_id, package_id, approver_role, state)
       VALUES ($1, $2, 'product-owner', 'open') RETURNING id`,
    [ids.stepRun, ids.package],
  );
  ids.decision = await insertId(
    `INSERT INTO decisions (gate_run_id, package_hash, reviewer_id, outcome)
       VALUES ($1, $2, 'u-reviewer', 'approve') RETURNING id`,
    [ids.gateRun, HASH],
  );
  ids.audit = await insertId(
    `INSERT INTO audit_events (id, occurred_at, actor_type, actor_id, action, entity_type,
         entity_id, data, prev_hash, hash)
       VALUES (gen_random_uuid(), now(), 'system', 'test', 'test.event', 'test', 'x', '{}', $1, $2)
       RETURNING id`,
    ['0'.repeat(64), HASH],
  );
});

afterAll(async () => {
  await db.close();
});

describe('insert-only tables', () => {
  it.each([
    ['artifact_versions', "UPDATE artifact_versions SET format = 'text'"],
    ['artifact_versions', 'DELETE FROM artifact_versions'],
    ['decisions', "UPDATE decisions SET feedback = 'edited'"],
    ['decisions', 'DELETE FROM decisions'],
    ['audit_events', "UPDATE audit_events SET action = 'forged'"],
    ['audit_events', 'DELETE FROM audit_events'],
    ['review_package_versions', 'DELETE FROM review_package_versions'],
    ['audit_events', 'TRUNCATE audit_events'],
    ['artifact_versions', 'TRUNCATE artifact_versions CASCADE'],
  ])('rejects changes to %s: %s', async (table, sql) => {
    await expect(db.pool.query(sql)).rejects.toThrow(`${table} is insert-only`);
  });

  it('still accepts inserts', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO artifact_versions (artifact_id, number, content_key, content_hash, format,
           created_by_type, created_by_id)
         VALUES ($1, 2, $2, $3, 'markdown', 'agent', 'brief-agent')`,
        [ids.artifact, `sha256/${OTHER_HASH}`, OTHER_HASH],
      ),
    ).resolves.toBeDefined();
  });
});

describe('unique constraints that make retries safe', () => {
  it('refuses a second version with the same number on one artifact', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO artifact_versions (artifact_id, number, content_key, content_hash, format,
           created_by_type, created_by_id)
         VALUES ($1, 1, $2, $3, 'markdown', 'user', 'u')`,
        [ids.artifact, `sha256/${HASH}`, HASH],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('refuses a second decision on one gate run', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO decisions (gate_run_id, package_hash, reviewer_id, outcome)
         VALUES ($1, $2, 'u-other', 'reject')`,
        [ids.gateRun, HASH],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('refuses a second open gate run on one step run', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO gate_runs (step_run_id, package_id, approver_role, state)
         VALUES ($1, $2, 'product-owner', 'open')`,
        [ids.stepRun, ids.package],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('refuses a second open package on one stage run', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO review_packages (stage_run_id, package_hash, submitted_by, status)
         VALUES ($1, $2, 'u', 'open')`,
        [ids.stageRun, OTHER_HASH],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('allows any number of closed packages on one stage run', async () => {
    const insertClosed = () =>
      db.pool.query(
        `INSERT INTO review_packages (stage_run_id, package_hash, submitted_by, status)
         VALUES ($1, $2, 'u', 'superseded')`,
        [ids.stageRun, OTHER_HASH],
      );

    await insertClosed();
    await expect(insertClosed()).resolves.toBeDefined();
  });

  it('refuses a duplicate job idempotency key', async () => {
    const insertJob = () =>
      db.pool.query(
        `INSERT INTO jobs (type, payload, idempotency_key) VALUES ('log', '{}', 'same-key')`,
      );

    await insertJob();
    await expect(insertJob()).rejects.toThrow(/duplicate key/);
  });
});

describe('CHECK constraints on enum-like columns', () => {
  it.each([
    [
      'an unknown initiative status',
      `INSERT INTO initiatives (title, requester_id, owner_id, status, current_stage_key)
       VALUES ('x', 'u', 'u', 'paused', 'brief')`,
    ],
    [
      'an unknown step type',
      `INSERT INTO step_runs (stage_run_id, step_key, step_type, position, cycle, state)
       VALUES ('${'00000000-0000-0000-0000-000000000000'}', 'k', 'meeting', 0, 1, 'pending')`,
    ],
    [
      'an unknown decision outcome',
      `INSERT INTO decisions (gate_run_id, package_hash, reviewer_id, outcome)
       VALUES (gen_random_uuid(), '${HASH}', 'u', 'maybe')`,
    ],
    [
      'a rework target on an approval',
      `INSERT INTO decisions (gate_run_id, package_hash, reviewer_id, outcome, rework_target)
       VALUES (gen_random_uuid(), '${HASH}', 'u', 'approve', 'brief')`,
    ],
    [
      'a content hash that is not SHA-256 hex',
      `INSERT INTO artifact_versions (artifact_id, number, content_key, content_hash, format,
         created_by_type, created_by_id)
       VALUES (gen_random_uuid(), 9, 'k', 'ABC', 'markdown', 'user', 'u')`,
    ],
    [
      'an unknown job status',
      `INSERT INTO jobs (type, payload, idempotency_key, status) VALUES ('log', '{}', 'k2', 'lost')`,
    ],
    [
      'an answered question without an answer',
      `INSERT INTO open_questions (version_id, text, blocking, status)
       VALUES (gen_random_uuid(), 'q', true, 'answered')`,
    ],
    [
      'initiative flags that are not an object',
      `INSERT INTO initiatives (title, requester_id, owner_id, status, current_stage_key, flags)
       VALUES ('x', 'u', 'u', 'active', 'brief', '[]')`,
    ],
  ])('rejects %s', async (_name, sql) => {
    await expect(db.pool.query(sql)).rejects.toThrow(/violates check constraint/);
  });
});

describe('initiative keys', () => {
  it('numbers initiatives with a readable key', async () => {
    const row = await one('SELECT key FROM initiatives WHERE id = $1', [ids.initiative]);

    expect(row.key).toMatch(/^INI-\d{4,}$/);
  });
});

describe('audit chain head', () => {
  it('starts at the genesis hash', async () => {
    const row = await one('SELECT last_hash, last_seq FROM audit_chain_head');

    expect(row).toEqual({ last_hash: '0'.repeat(64), last_seq: '0' });
  });

  it('holds exactly one row', async () => {
    await expect(
      db.pool.query(
        "INSERT INTO audit_chain_head (id, last_seq, last_hash) VALUES (false, 0, 'x')",
      ),
    ).rejects.toThrow();
  });
});
