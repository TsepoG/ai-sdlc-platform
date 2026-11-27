// @ts-check
import { beforeAll, describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '../../src/errors/index.js';
import { nextMove } from '../../src/workflow/index.js';
import { realStage } from './real-stages.js';

/** @typedef {import('../../src/stages/index.js').StageDefinition} StageDefinition */

const NO_FLAGS = { flags: {} };
const PREPROD = { flags: { requiresPreprod: true } };
const TDF = { flags: { requiresTdf: true } };

/** @type {StageDefinition} */
let brief;
/** @type {StageDefinition} */
let techDesign;
/** @type {StageDefinition} */
let build;
/** @type {StageDefinition} */
let test;

beforeAll(async () => {
  [brief, techDesign, build, test] = await Promise.all(
    ['brief', 'tech-design', 'build', 'test'].map(realStage),
  );
});

describe('nextMove', () => {
  describe('done', () => {
    it('moves to the next planned step', () => {
      expect(nextMove(test, NO_FLAGS, 'deploy-sit', { kind: 'done' })).toEqual({
        kind: 'next_step',
        stepKey: 'sit-testing',
      });
    });

    it('moves from SIT sign-off to deploy to UAT', () => {
      expect(nextMove(test, NO_FLAGS, 'sit-signoff', { kind: 'done' })).toEqual({
        kind: 'next_step',
        stepKey: 'deploy-uat',
      });
    });

    it('approves the test stage at UAT sign-off without preprod', () => {
      expect(nextMove(test, NO_FLAGS, 'uat-signoff', { kind: 'done' })).toEqual({
        kind: 'stage_approved',
      });
    });

    it('moves from UAT sign-off to deploy to preprod with requiresPreprod', () => {
      expect(nextMove(test, PREPROD, 'uat-signoff', { kind: 'done' })).toEqual({
        kind: 'next_step',
        stepKey: 'deploy-preprod',
      });
    });

    it('approves the test stage at preprod sign-off with requiresPreprod', () => {
      expect(nextMove(test, PREPROD, 'preprod-signoff', { kind: 'done' })).toEqual({
        kind: 'stage_approved',
      });
    });

    it('approves the brief stage after its single gate', () => {
      expect(nextMove(brief, NO_FLAGS, 'epic-approval', { kind: 'done' })).toEqual({
        kind: 'stage_approved',
      });
    });

    it('approves tech design at design review without requiresTdf', () => {
      expect(nextMove(techDesign, NO_FLAGS, 'design-review', { kind: 'done' })).toEqual({
        kind: 'stage_approved',
      });
    });

    it('moves tech design from design review to TDF approval with requiresTdf', () => {
      expect(nextMove(techDesign, TDF, 'design-review', { kind: 'done' })).toEqual({
        kind: 'next_step',
        stepKey: 'tdf-approval',
      });
    });
  });

  describe('changes requested at a gate', () => {
    it('restarts the test stage at deploy-sit from UAT sign-off', () => {
      expect(nextMove(test, NO_FLAGS, 'uat-signoff', { kind: 'changes_requested' })).toEqual({
        kind: 'restart',
        stepKey: 'deploy-sit',
      });
    });

    it('restarts the brief stage at draft-brief', () => {
      expect(nextMove(brief, NO_FLAGS, 'epic-approval', { kind: 'changes_requested' })).toEqual({
        kind: 'restart',
        stepKey: 'draft-brief',
      });
    });
  });

  describe('rejected at a gate', () => {
    it('reworks to a listed target', () => {
      expect(
        nextMove(test, NO_FLAGS, 'sit-signoff', {
          kind: 'rejected',
          reworkTarget: 'work-breakdown',
        }),
      ).toEqual({ kind: 'rework', stageKey: 'work-breakdown' });
    });

    it('cancels the Initiative when the brief is rejected without a target', () => {
      expect(nextMove(brief, NO_FLAGS, 'epic-approval', { kind: 'rejected' })).toEqual({
        kind: 'cancelled',
      });
    });
  });

  describe('failed', () => {
    it('pauses at a failed deployment', () => {
      expect(nextMove(test, NO_FLAGS, 'deploy-sit', { kind: 'failed' })).toEqual({
        kind: 'paused',
        stepKey: 'deploy-sit',
      });
    });

    it('reworks a failed SIT test to build', () => {
      expect(nextMove(test, NO_FLAGS, 'sit-testing', { kind: 'failed' })).toEqual({
        kind: 'rework',
        stageKey: 'build',
      });
    });

    it('reworks failed dev tests to work breakdown', () => {
      expect(nextMove(build, NO_FLAGS, 'dev-tests', { kind: 'failed' })).toEqual({
        kind: 'rework',
        stageKey: 'work-breakdown',
      });
    });

    it('pauses a failed agent draft in tech design instead of sending it upstream', () => {
      expect(nextMove(techDesign, NO_FLAGS, 'draft-design', { kind: 'failed' })).toEqual({
        kind: 'paused',
        stepKey: 'draft-design',
      });
    });

    it('pauses a failed brief draft', () => {
      expect(nextMove(brief, NO_FLAGS, 'draft-brief', { kind: 'failed' })).toEqual({
        kind: 'paused',
        stepKey: 'draft-brief',
      });
    });

    it('pauses a failed people-or-test work step when the stage has no rework targets', () => {
      /** @type {StageDefinition} */
      const stage = {
        ...brief,
        steps: [{ key: 'check', type: 'work' }, ...brief.steps.slice(1)],
      };

      expect(nextMove(stage, NO_FLAGS, 'check', { kind: 'failed' })).toEqual({
        kind: 'paused',
        stepKey: 'check',
      });
    });
  });

  describe('invalid transitions', () => {
    it.each([
      ['changes_requested on a work step', 'sit-testing', { kind: 'changes_requested' }],
      ['changes_requested on an action step', 'deploy-sit', { kind: 'changes_requested' }],
      ['rejected on a work step', 'sit-testing', { kind: 'rejected' }],
      ['rejected on an action step', 'deploy-uat', { kind: 'rejected' }],
      ['failed on a gate', 'sit-signoff', { kind: 'failed' }],
      [
        'a rework target not in the list',
        'sit-signoff',
        { kind: 'rejected', reworkTarget: 'brief' },
      ],
      ['a rework target with done', 'sit-signoff', { kind: 'done', reworkTarget: 'build' }],
      ['a rework target with failed', 'sit-testing', { kind: 'failed', reworkTarget: 'build' }],
      ['a skipped step as current step', 'preprod-signoff', { kind: 'done' }],
      ['an unknown step', 'prod-signoff', { kind: 'done' }],
      ['an unknown outcome', 'sit-signoff', { kind: 'approved' }],
      ['an inherited property as outcome', 'sit-signoff', { kind: 'toString' }],
    ])('throws InvalidTransitionError for %s', (_name, stepKey, outcome) => {
      const move = () =>
        nextMove(
          test,
          NO_FLAGS,
          stepKey,
          /** @type {import('../../src/workflow/index.js').StepOutcome} */ (outcome),
        );

      expect(move).toThrow(InvalidTransitionError);
    });

    it('refuses any rework target when the stage has none', () => {
      expect(() =>
        nextMove(brief, NO_FLAGS, 'epic-approval', { kind: 'rejected', reworkTarget: 'brief' }),
      ).toThrow(/allowed: none/);
    });

    it('says when the current step was skipped for these flags', () => {
      expect(() => nextMove(test, NO_FLAGS, 'deploy-preprod', { kind: 'done' })).toThrow(/skipped/);
    });
  });
});
