// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GateNotOpenError,
  InvalidTransitionError,
  NotAuthorisedError,
  NotFoundError,
  SeparationOfDutiesError,
  StalePackageError,
} from '../../src/errors/index.js';
import { AUTHOR, createHarness, draftAndSubmit, REVIEWER } from './harness.js';

const PRODUCT_OWNER = ['product-owner'];
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/** @type {import('./harness.js').Harness} */
let harness;
/** @type {string} */
let initiativeId;
/** @type {Awaited<ReturnType<typeof draftAndSubmit>>} */
let review;

beforeEach(async () => {
  harness = await createHarness();
  ({ id: initiativeId } = await harness.service.createInitiative(
    { title: 'Synthetic', request: 'A request.' },
    AUTHOR,
  ));
  review = await draftAndSubmit(harness, initiativeId, 'brief');
});

afterEach(async () => {
  await harness.close();
});

/**
 * Counts of the tables a refused decision must not touch.
 * @returns {Promise<number[]>} Decisions and audit events.
 */
async function writes() {
  return [await harness.count('decisions'), await harness.count('audit_events')];
}

/**
 * Decide the open review gate.
 * @param {Partial<import('../../src/initiatives/index.js').DecideInput>} input Overrides.
 * @param {import('../../src/initiatives/index.js').Actor} [actor] Reviewer.
 * @param {string[]} [roles] Reviewer roles.
 * @returns {ReturnType<import('../../src/initiatives/index.js').WorkflowService['decide']>} Result.
 */
function decideReview(input, actor = REVIEWER, roles = PRODUCT_OWNER) {
  return harness.service.decide(
    /** @type {string} */ (review.gateRunId),
    { outcome: 'approve', packageHash: review.packageHash, ...input },
    actor,
    roles,
  );
}

describe('decide refuses without writing anything', () => {
  it('refuses a stale package hash with 409', async () => {
    const before = await writes();

    await expect(decideReview({ packageHash: 'f'.repeat(64) })).rejects.toThrow(StalePackageError);
    expect(await writes()).toEqual(before);
  });

  it('refuses the package author with 403, even holding the role', async () => {
    const before = await writes();

    await expect(decideReview({}, AUTHOR, PRODUCT_OWNER)).rejects.toThrow(SeparationOfDutiesError);
    expect(await writes()).toEqual(before);
  });

  it('refuses a reviewer without the gate role with 403', async () => {
    const before = await writes();

    await expect(decideReview({}, REVIEWER, ['tech-lead'])).rejects.toThrow(NotAuthorisedError);
    expect(await writes()).toEqual(before);
  });

  it('refuses a rework target the stage does not allow', async () => {
    const before = await writes();

    await expect(decideReview({ outcome: 'reject', reworkTarget: 'brief' })).rejects.toThrow(
      InvalidTransitionError,
    );
    expect(await writes()).toEqual(before);
  });

  it('refuses an unknown gate run with 404', async () => {
    await expect(
      harness.service.decide(
        UNKNOWN_ID,
        { outcome: 'approve', packageHash: review.packageHash },
        REVIEWER,
        PRODUCT_OWNER,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('decide', () => {
  it('lets exactly one of two concurrent decisions win', async () => {
    const results = await Promise.allSettled([
      decideReview({ outcome: 'approve' }),
      decideReview({ outcome: 'request_changes' }, { type: 'user', id: 'u-reviewer-2' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [rejected] = results.filter((result) => result.status === 'rejected');
    expect(/** @type {PromiseRejectedResult} */ (rejected).reason).toBeInstanceOf(GateNotOpenError);
    expect(await harness.count('decisions')).toBe(1);
  });

  it('refuses to decide a gate twice', async () => {
    await decideReview({ outcome: 'request_changes' });

    await expect(decideReview({ outcome: 'approve' })).rejects.toThrow(GateNotOpenError);
  });

  it('cancels the Initiative when the brief is rejected without a target', async () => {
    const result = await decideReview({ outcome: 'reject', feedback: 'Out of scope.' });

    expect(result.move).toEqual({ kind: 'cancelled' });
    const view = await harness.service.getInitiative(initiativeId);
    expect(view.status).toBe('cancelled');
    expect(view.stageRuns[0].state).toBe('cancelled');
    expect(view.stageRuns[0].packages[0].status).toBe('rejected');
  });

  it('refuses further submissions once the stage run is cancelled', async () => {
    await decideReview({ outcome: 'reject' });

    await expect(
      harness.service.submitPackage(review.stageRunId, [review.versionId], AUTHOR),
    ).rejects.toThrow(InvalidTransitionError);
  });
});
