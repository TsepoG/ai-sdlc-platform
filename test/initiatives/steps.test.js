// @ts-check
// A gate followed by an action step, using the real Build stage on its own (its inputs are
// ignored here): approving the PR review starts the dev deployment step.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeRun, AUTHOR, createHarness, draftAndSubmit, REVIEWER } from './harness.js';

/** @type {import('./harness.js').Harness} */
let harness;

beforeEach(async () => {
  harness = await createHarness({
    adjustStages: (stages) =>
      stages
        .filter((stage) => stage.key === 'build')
        .map((stage) => ({ ...stage, order: 1, enabled: true })),
  });
});

afterEach(async () => {
  await harness.close();
});

describe('steps after a gate', () => {
  it('starts the next action step running when the gate is approved', async () => {
    const { id } = await harness.service.createInitiative({ title: 'x', request: 'x' }, AUTHOR);
    const review = await draftAndSubmit(harness, id, 'build');

    const { move } = await harness.service.decide(
      /** @type {string} */ (review.gateRunId),
      { outcome: 'approve', packageHash: review.packageHash },
      REVIEWER,
      ['senior-engineer'],
    );

    expect(move).toEqual({ kind: 'next_step', stepKey: 'deploy-dev' });
    const run = await activeRun(harness, id, 'build');
    expect(run.steps.map((step) => [step.stepKey, step.state])).toEqual([
      ['code-and-test', 'done'],
      ['pr-review', 'done'],
      ['deploy-dev', 'running'],
      ['dev-tests', 'pending'],
      ['dev-verified', 'pending'],
    ]);
  });
});
