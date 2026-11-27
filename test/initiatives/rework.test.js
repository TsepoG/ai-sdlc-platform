// @ts-check
// Handoff and rework with a fixture where three stages are enabled (the real config enables
// only Brief). Alpha → Beta → Gamma; Gamma can rework to Alpha or Beta.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../../src/audit/index.js';
import { InvalidTransitionError } from '../../src/errors/index.js';
import {
  activeRun,
  AUTHOR,
  createHarness,
  draftAndSubmit,
  REVIEWER,
  THREE_STAGES,
} from './harness.js';

const LEAD = ['lead'];

/** @type {import('./harness.js').Harness} */
let harness;
/** @type {string} */
let initiativeId;

beforeEach(async () => {
  harness = await createHarness({ stagesDir: THREE_STAGES });
  ({ id: initiativeId } = await harness.service.createInitiative(
    { title: 'Synthetic', request: 'A request.' },
    AUTHOR,
  ));
});

afterEach(async () => {
  await harness.close();
});

/**
 * Draft, submit and approve a stage's first gate.
 * @param {string} stageKey Stage.
 * @returns {Promise<Awaited<ReturnType<typeof draftAndSubmit>> & { move: import('../../src/workflow/index.js').Move }>}
 *   The package and the move its approval caused.
 */
async function approveStage(stageKey) {
  const submitted = await draftAndSubmit(harness, initiativeId, stageKey);
  const { move } = await harness.service.decide(
    /** @type {string} */ (submitted.gateRunId),
    { outcome: 'approve', packageHash: submitted.packageHash },
    REVIEWER,
    LEAD,
  );
  return { ...submitted, move };
}

/**
 * Stage runs as `key#attempt:state`, oldest first.
 * @returns {Promise<string[]>} Summary.
 */
async function runSummary() {
  const view = await harness.service.getInitiative(initiativeId);
  return view.stageRuns.map((run) => `${run.stageKey}#${run.attempt}:${run.state}`);
}

describe('stage handoff', () => {
  it('starts the next enabled stage with the approved package as its input', async () => {
    const alpha = await approveStage('alpha');

    const beta = await activeRun(harness, initiativeId, 'beta');
    expect(beta.inputPackageId).toBe(alpha.id);
    expect((await harness.service.getInitiative(initiativeId)).currentStageKey).toBe('beta');
  });

  it('opens the next gate on the same package when a gate is approved mid-stage', async () => {
    await approveStage('alpha');
    await approveStage('beta');

    const review = await approveStage('gamma');

    expect(review.move).toEqual({ kind: 'next_step', stepKey: 'signoff-gamma' });
    const gamma = await activeRun(harness, initiativeId, 'gamma');
    expect(gamma.gates.map((gate) => [gate.state, gate.packageId])).toEqual([
      ['decided', review.id],
      ['open', review.id],
    ]);
  });

  it('sends a resubmission made at a later gate back through every gate from the first', async () => {
    await approveStage('alpha');
    await approveStage('beta');
    const first = await approveStage('gamma');
    expect(first.move).toEqual({ kind: 'next_step', stepKey: 'signoff-gamma' });

    const resubmitted = await draftAndSubmit(harness, initiativeId, 'gamma', 'changed content');

    const gamma = await activeRun(harness, initiativeId, 'gamma');
    const open = gamma.gates.filter((gate) => gate.state === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(resubmitted.gateRunId);
    const openStep = gamma.steps.find((step) => step.id === open[0].stepRunId);
    expect(openStep).toMatchObject({ stepKey: 'review-gamma', cycle: 2 });
    const { move } = await harness.service.decide(
      /** @type {string} */ (resubmitted.gateRunId),
      { outcome: 'approve', packageHash: resubmitted.packageHash },
      REVIEWER,
      LEAD,
    );
    expect(move).toEqual({ kind: 'next_step', stepKey: 'signoff-gamma' });
  });

  it('marks the Initiative done after the last stage', async () => {
    await approveStage('alpha');
    await approveStage('beta');
    await approveStage('gamma');
    const gamma = await activeRun(harness, initiativeId, 'gamma');
    const signoff = /** @type {{ id: string }} */ (
      gamma.gates.find((gate) => gate.state === 'open')
    );

    const { move } = await harness.service.decide(
      signoff.id,
      { outcome: 'approve', packageHash: gamma.packages[0].packageHash },
      REVIEWER,
      LEAD,
    );

    expect(move).toEqual({ kind: 'stage_approved' });
    expect((await harness.service.getInitiative(initiativeId)).status).toBe('done');
  });
});

describe('rework', () => {
  /**
   * Approve alpha and beta, then reject gamma back to alpha.
   * @returns {Promise<{ beta: Awaited<ReturnType<typeof approveStage>>, move: import('../../src/workflow/index.js').Move }>}
   *   Beta's approval and the move the rejection caused.
   */
  async function reworkGammaToAlpha() {
    await approveStage('alpha');
    const beta = await approveStage('beta');
    const gamma = await draftAndSubmit(harness, initiativeId, 'gamma');
    const { move } = await harness.service.decide(
      /** @type {string} */ (gamma.gateRunId),
      {
        outcome: 'reject',
        reworkTarget: 'alpha',
        packageHash: gamma.packageHash,
        feedback: 'Rethink.',
      },
      REVIEWER,
      LEAD,
    );
    return { beta, move };
  }

  it('supersedes every later run, approved or active, and starts a new attempt at the target', async () => {
    const { move } = await reworkGammaToAlpha();

    expect(move).toEqual({ kind: 'rework', stageKey: 'alpha' });
    expect(await runSummary()).toEqual([
      'alpha#1:approved',
      'beta#1:superseded',
      'gamma#1:superseded',
      'alpha#2:active',
    ]);
    const view = await harness.service.getInitiative(initiativeId);
    expect(view).toMatchObject({ status: 'active', currentStageKey: 'alpha' });
  });

  it('starts fresh downstream attempts from the re-approved package', async () => {
    await reworkGammaToAlpha();

    const alphaAgain = await approveStage('alpha');

    expect(await runSummary()).toEqual([
      'alpha#1:approved',
      'beta#1:superseded',
      'gamma#1:superseded',
      'alpha#2:approved',
      'beta#2:active',
    ]);
    expect((await activeRun(harness, initiativeId, 'beta')).inputPackageId).toBe(alphaAgain.id);
    expect((await verifyAuditChain(harness.db.pool)).ok).toBe(true);
  });

  it('blocks work on a superseded run', async () => {
    const { beta } = await reworkGammaToAlpha();
    const view = await harness.service.getInitiative(initiativeId);
    const superseded = /** @type {import('../../src/initiatives/queries.js').StageRunView} */ (
      view.stageRuns.find((run) => run.id === beta.stageRunId)
    );

    await expect(
      harness.service.saveVersion(superseded.artifacts[0].id, { content: 'edit' }, AUTHOR),
    ).rejects.toThrow(InvalidTransitionError);
    await expect(
      harness.service.submitPackage(beta.stageRunId, [beta.versionId], AUTHOR),
    ).rejects.toThrow(InvalidTransitionError);
  });
});

describe('createInitiative', () => {
  it('stores the flags', async () => {
    const created = await harness.service.createInitiative(
      { title: 'Flagged', request: 'x', flags: { requiresTdf: true } },
      AUTHOR,
    );

    expect((await harness.service.getInitiative(created.id)).flags).toEqual({ requiresTdf: true });
  });

  it('refuses to start when the first stage is not enabled', async () => {
    const disabled = await createHarness({
      stagesDir: THREE_STAGES,
      adjustStages: (stages) => stages.map((stage) => ({ ...stage, enabled: stage.order !== 1 })),
    });
    try {
      await expect(
        disabled.service.createInitiative({ title: 'x', request: 'x' }, AUTHOR),
      ).rejects.toThrow(InvalidTransitionError);
    } finally {
      await disabled.close();
    }
  });
});
