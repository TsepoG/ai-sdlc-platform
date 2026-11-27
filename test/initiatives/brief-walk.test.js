// @ts-check
// End-to-end against PostgreSQL: create → save version → submit → request changes → new
// version → resubmit → approve. Only Brief is enabled, so the Initiative ends awaiting UX design.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../../src/audit/index.js';
import { activeRun, AUTHOR, createHarness, REVIEWER } from './harness.js';

const PRODUCT_OWNER = ['product-owner'];

/** @type {import('./harness.js').Harness} */
let harness;
/** @type {string} */
let initiativeId;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

describe('walking an Initiative through the Brief stage', () => {
  /** @type {string} */
  let epicsArtifactId;
  /** @type {string} */
  let stageRunId;
  /** @type {{ gateRunId: string, packageHash: string }} */
  let firstReview;

  it('creates the Initiative at Brief with its first step running', async () => {
    const created = await harness.service.createInitiative(
      {
        title: 'Synthetic loyalty feature',
        request: 'Customers want points.',
        notes: 'Pilot first.',
      },
      AUTHOR,
    );
    initiativeId = created.id;

    const view = await harness.service.getInitiative(initiativeId);
    expect(created.key).toMatch(/^INI-\d{4,}$/);
    expect(view).toMatchObject({ status: 'active', currentStageKey: 'brief' });
    const [run] = view.stageRuns;
    expect(run).toMatchObject({ stageKey: 'brief', attempt: 1, state: 'active' });
    expect(run.steps.map((step) => [step.stepKey, step.state])).toEqual([
      ['draft-brief', 'running'],
      ['epic-approval', 'pending'],
    ]);
    expect(run.artifacts.map((artifact) => artifact.type).sort()).toEqual([
      'business-request',
      'epics',
      'feature-hypothesis',
      'nfrs',
      'stakeholder-notes',
      'user-journeys',
    ]);
    stageRunId = run.id;
    epicsArtifactId = /** @type {{ id: string }} */ (
      run.artifacts.find((artifact) => artifact.type === 'epics')
    ).id;
  });

  it('stores the request and notes as user-created versions', async () => {
    const run = await activeRun(harness, initiativeId, 'brief');
    const request = run.artifacts.find((artifact) => artifact.type === 'business-request');

    const version = await harness.service.getVersion(
      /** @type {string} */ (request?.latestVersionId),
    );

    expect(version).toMatchObject({
      number: 1,
      createdByType: 'user',
      createdById: AUTHOR.id,
      content: 'Customers want points.',
    });
  });

  it('saves a draft version and submits it, opening the epic approval gate', async () => {
    const version = await harness.service.saveVersion(
      epicsArtifactId,
      { content: '# Epics\n\n- Earn points\n' },
      AUTHOR,
    );

    const submitted = await harness.service.submitPackage(stageRunId, [version.id], AUTHOR);

    expect(version.number).toBe(1);
    expect(submitted.packageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(submitted.gateRunId).toEqual(expect.any(String));
    const run = await activeRun(harness, initiativeId, 'brief');
    expect(run.steps.map((step) => step.state)).toEqual(['done', 'waiting']);
    expect(run.gates[0]).toMatchObject({ approverRole: 'product-owner', state: 'open' });
    expect(run.gates[0].dueAt).not.toBeNull();
    firstReview = {
      gateRunId: /** @type {string} */ (submitted.gateRunId),
      packageHash: submitted.packageHash,
    };
  });

  it('restarts the steps when the reviewer requests changes', async () => {
    const result = await harness.service.decide(
      firstReview.gateRunId,
      { outcome: 'request_changes', packageHash: firstReview.packageHash, feedback: 'Add NFRs.' },
      REVIEWER,
      PRODUCT_OWNER,
    );

    expect(result.move).toEqual({ kind: 'restart', stepKey: 'draft-brief' });
    const run = await activeRun(harness, initiativeId, 'brief');
    expect(run.packages[0].status).toBe('changes_requested');
    expect(run.steps.filter((step) => step.cycle === 2).map((step) => step.state)).toEqual([
      'running',
      'pending',
    ]);
  });

  it('approves a resubmitted new version, leaving the Initiative awaiting UX design', async () => {
    const version = await harness.service.saveVersion(
      epicsArtifactId,
      { content: '# Epics\n\n- Earn points\n- Spend points\n' },
      AUTHOR,
    );
    const resubmitted = await harness.service.submitPackage(stageRunId, [version.id], AUTHOR);

    const result = await harness.service.decide(
      /** @type {string} */ (resubmitted.gateRunId),
      { outcome: 'approve', packageHash: resubmitted.packageHash },
      REVIEWER,
      PRODUCT_OWNER,
    );

    expect(version.number).toBe(2);
    expect(result.move).toEqual({ kind: 'stage_approved' });
    const view = await harness.service.getInitiative(initiativeId);
    expect(view).toMatchObject({ status: 'awaiting_stage', currentStageKey: 'ux-design' });
    expect(view.stageRuns).toHaveLength(1);
    expect(view.stageRuns[0].state).toBe('approved');
    expect(view.stageRuns[0].packages.map((pkg) => pkg.status)).toEqual([
      'changes_requested',
      'approved',
    ]);
  });

  it('lists every step in the timeline, in order', async () => {
    const timeline = await harness.service.getTimeline(initiativeId);

    expect(timeline.map((event) => event.action)).toEqual([
      'initiative.created',
      'stage_run.started',
      'version.saved',
      'version.saved',
      'version.saved',
      'package.submitted',
      'decision.recorded',
      'stage_run.restarted',
      'version.saved',
      'package.submitted',
      'decision.recorded',
      'stage_run.approved',
      'initiative.awaiting_stage',
    ]);
    expect(timeline.every((event) => event.initiativeId === initiativeId)).toBe(true);
  });

  it('leaves an audit chain that verifies', async () => {
    const result = await verifyAuditChain(harness.db.pool);

    expect(result).toEqual({ ok: true, checked: 13 });
  });
});
