// @ts-check
import { beforeAll, describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '../../src/errors/index.js';
import {
  findStaleRuns,
  initialStepRuns,
  nextStage,
  stageByKey,
  stageConfigVersion,
  toStepOutcome,
} from '../../src/initiatives/plan.js';
import { loadStages } from '../../src/stages/index.js';
import { REAL_STAGES_DIR } from '../server/helpers.js';

/** @type {ReadonlyArray<import('../../src/stages/index.js').StageDefinition>} */
let stages;

beforeAll(async () => {
  stages = await loadStages(REAL_STAGES_DIR);
});

describe('toStepOutcome', () => {
  it.each([
    [{ outcome: 'approve' }, { kind: 'done' }],
    [{ outcome: 'request_changes' }, { kind: 'changes_requested' }],
    [{ outcome: 'reject' }, { kind: 'rejected' }],
    [
      { outcome: 'reject', reworkTarget: 'brief' },
      { kind: 'rejected', reworkTarget: 'brief' },
    ],
  ])('maps %j to %j', (decision, expected) => {
    expect(
      toStepOutcome(
        /** @type {import('../../src/initiatives/plan.js').DecisionInput} */ (decision),
      ),
    ).toEqual(expected);
  });

  it('keeps a rework target on a non-reject so nextMove refuses it', () => {
    expect(toStepOutcome({ outcome: 'approve', reworkTarget: 'brief' })).toEqual({
      kind: 'done',
      reworkTarget: 'brief',
    });
  });
});

describe('stageByKey and nextStage', () => {
  it('finds a stage by key', () => {
    expect(stageByKey(stages, 'deploy').name).toBe('Deploy');
  });

  it('throws for a stage the configuration no longer has', () => {
    expect(() => stageByKey(stages, 'retired')).toThrow(InvalidTransitionError);
  });

  it('returns the next stage by order', () => {
    expect(nextStage(stages, 'brief')?.key).toBe('ux-design');
  });

  it('returns undefined after the last stage', () => {
    expect(nextStage(stages, 'test')).toBeUndefined();
  });
});

describe('stageConfigVersion', () => {
  it('is a SHA-256 hex digest that changes with the definition', () => {
    const brief = stageByKey(stages, 'brief');

    expect(stageConfigVersion(brief)).toMatch(/^[0-9a-f]{64}$/);
    expect(stageConfigVersion({ ...brief, name: 'Renamed' })).not.toBe(stageConfigVersion(brief));
  });
});

describe('initialStepRuns', () => {
  it('starts the first planned step and leaves the rest pending', () => {
    expect(initialStepRuns(stageByKey(stages, 'brief'), { flags: {} })).toEqual([
      { stepKey: 'draft-brief', stepType: 'work', position: 0, state: 'running' },
      { stepKey: 'epic-approval', stepType: 'gate', position: 1, state: 'pending' },
    ]);
  });

  it('records conditional steps whose flag is off as skipped', () => {
    const runs = initialStepRuns(stageByKey(stages, 'tech-design'), { flags: {} });

    expect(runs.find((run) => run.stepKey === 'tdf-approval')?.state).toBe('skipped');
  });
});

describe('findStaleRuns', () => {
  /** Runs: A1 (old approval) -> B1 approved -> C1; A2 newly approved after rework. */
  const runs = [
    { id: 'a1', stageKey: 'a', state: 'superseded', inputPackageId: null },
    { id: 'b1', stageKey: 'b', state: 'approved', inputPackageId: 'pa1' },
    { id: 'c1', stageKey: 'c', state: 'superseded', inputPackageId: 'pb1' },
    { id: 'a2', stageKey: 'a', state: 'approved', inputPackageId: null },
  ];
  const packages = [
    { id: 'pa1', stageRunId: 'a1' },
    { id: 'pb1', stageRunId: 'b1' },
    { id: 'pa2', stageRunId: 'a2' },
  ];

  it('flags approved downstream runs built on an older package of the re-approved stage', () => {
    expect(
      findStaleRuns({ runs, packages, approvedRunId: 'a2', approvedPackageId: 'pa2' }),
    ).toEqual(['b1']);
  });

  it('ignores runs built on the newly approved package', () => {
    const fresh = [...runs, { id: 'b2', stageKey: 'b', state: 'approved', inputPackageId: 'pa2' }];

    expect(
      findStaleRuns({ runs: fresh, packages, approvedRunId: 'a2', approvedPackageId: 'pa2' }),
    ).toEqual(['b1']);
  });

  it('flags nothing on a first approval', () => {
    expect(
      findStaleRuns({
        runs: [{ id: 'a1', stageKey: 'a', state: 'approved', inputPackageId: null }],
        packages: [{ id: 'pa1', stageRunId: 'a1' }],
        approvedRunId: 'a1',
        approvedPackageId: 'pa1',
      }),
    ).toEqual([]);
  });
});
