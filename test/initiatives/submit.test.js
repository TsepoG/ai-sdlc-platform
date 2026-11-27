// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BlockingQuestionsError,
  InvalidPackageError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '../../src/errors/index.js';
import { activeRun, AUTHOR, createHarness, draftAndSubmit, REVIEWER } from './harness.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/** @type {import('./harness.js').Harness} */
let harness;
/** @type {string} */
let initiativeId;
/** @type {import('../../src/initiatives/queries.js').StageRunView} */
let run;

beforeEach(async () => {
  harness = await createHarness();
  ({ id: initiativeId } = await harness.service.createInitiative(
    { title: 'Synthetic', request: 'A request.' },
    AUTHOR,
  ));
  run = await activeRun(harness, initiativeId, 'brief');
});

afterEach(async () => {
  await harness.close();
});

/**
 * ID of the run's artifact of a type.
 * @param {string} type Artifact type.
 * @returns {string} Artifact ID.
 */
function artifactOf(type) {
  return /** @type {{ id: string }} */ (run.artifacts.find((artifact) => artifact.type === type))
    .id;
}

/**
 * Save a version into an artifact of the run.
 * @param {string} type Artifact type.
 * @param {string} [content] Content.
 * @returns {Promise<import('../../src/initiatives/index.js').VersionView>} The version.
 */
function save(type, content = `# ${type}`) {
  return harness.service.saveVersion(artifactOf(type), { content }, AUTHOR);
}

describe('saveVersion', () => {
  it('numbers versions of an artifact in sequence', async () => {
    const first = await save('epics', 'one');
    const second = await save('epics', 'two');

    expect([first.number, second.number]).toEqual([1, 2]);
  });

  it('records the versions it was derived from', async () => {
    const first = await save('epics', 'one');

    const second = await harness.service.saveVersion(
      artifactOf('epics'),
      { content: 'two', format: 'text', sourceVersionIds: [first.id] },
      AUTHOR,
    );

    expect(second).toMatchObject({ format: 'text', sourceVersionIds: [first.id] });
  });

  it('refuses a source version from another Initiative', async () => {
    const other = await harness.service.createInitiative({ title: 'Other', request: 'x' }, AUTHOR);
    const otherRun = await activeRun(harness, other.id, 'brief');
    const foreign = await harness.service.saveVersion(
      /** @type {{ id: string }} */ (otherRun.artifacts[0]).id,
      { content: 'foreign' },
      AUTHOR,
    );

    await expect(
      harness.service.saveVersion(
        artifactOf('epics'),
        { content: 'x', sourceVersionIds: [foreign.id] },
        AUTHOR,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses an unknown artifact with 404', async () => {
    await expect(harness.service.saveVersion(UNKNOWN_ID, { content: 'x' }, AUTHOR)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('refuses new versions once the stage run is approved', async () => {
    const submitted = await draftAndSubmit(harness, initiativeId, 'brief');
    await harness.service.decide(
      /** @type {string} */ (submitted.gateRunId),
      { outcome: 'approve', packageHash: submitted.packageHash },
      REVIEWER,
      ['product-owner'],
    );

    await expect(save('epics', 'late edit')).rejects.toThrow(InvalidTransitionError);
  });

  it('reads back an unknown version as 404', async () => {
    await expect(harness.service.getVersion(UNKNOWN_ID)).rejects.toThrow(NotFoundError);
  });
});

describe('submitPackage', () => {
  it('refuses submission while a blocking question is open, and allows it once answered', async () => {
    const version = await save('epics');
    const question = await harness.service.addOpenQuestion(
      version.id,
      { text: 'Which markets?', blocking: true },
      { type: 'agent', id: 'product-brief-agent' },
    );

    await expect(harness.service.submitPackage(run.id, [version.id], AUTHOR)).rejects.toThrow(
      BlockingQuestionsError,
    );
    await harness.service.answerQuestion(question.id, { answer: 'UK only.' }, AUTHOR);
    await expect(
      harness.service.submitPackage(run.id, [version.id], AUTHOR),
    ).resolves.toBeDefined();
  });

  it('lets a non-blocking question through', async () => {
    const version = await save('epics');
    await harness.service.addOpenQuestion(
      version.id,
      { text: 'Nice to know?', blocking: false },
      AUTHOR,
    );

    await expect(
      harness.service.submitPackage(run.id, [version.id], AUTHOR),
    ).resolves.toBeDefined();
  });

  it('refuses an empty package', async () => {
    await expect(harness.service.submitPackage(run.id, [], AUTHOR)).rejects.toThrow(
      InvalidPackageError,
    );
  });

  it('refuses an input version, which is not one of the stage outputs', async () => {
    const request = /** @type {string} */ (
      run.artifacts.find((artifact) => artifact.type === 'business-request')?.latestVersionId
    );

    await expect(harness.service.submitPackage(run.id, [request], AUTHOR)).rejects.toThrow(
      InvalidPackageError,
    );
  });

  it('refuses two versions of the same artifact', async () => {
    const first = await save('epics', 'one');
    const second = await save('epics', 'two');

    await expect(
      harness.service.submitPackage(run.id, [first.id, second.id], AUTHOR),
    ).rejects.toThrow(InvalidPackageError);
  });

  it('packages several artifacts together', async () => {
    const epics = await save('epics');
    const nfrs = await save('nfrs');

    const submitted = await harness.service.submitPackage(run.id, [epics.id, nfrs.id], AUTHOR);

    expect(submitted.versionIds).toEqual([epics.id, nfrs.id]);
  });

  it('supersedes an open package and reopens its gate on the new one', async () => {
    const first = await draftAndSubmit(harness, initiativeId, 'brief', 'first');
    const newer = await save('epics', 'second');

    const second = await harness.service.submitPackage(run.id, [newer.id], AUTHOR);

    const view = await activeRun(harness, initiativeId, 'brief');
    expect(view.packages.map((pkg) => pkg.status)).toEqual(['superseded', 'open']);
    expect(view.gates.map((gate) => [gate.id === first.gateRunId, gate.state])).toEqual([
      [true, 'cancelled'],
      [false, 'open'],
    ]);
    expect(second.gateRunId).not.toBe(first.gateRunId);
    expect(view.steps.filter((step) => step.cycle === 2).map((step) => step.state)).toEqual([
      'done',
      'waiting',
    ]);
    const actions = (await harness.service.getTimeline(initiativeId)).map((event) => event.action);
    expect(actions).toContain('stage_run.restarted');
  });

  it('refuses an unknown stage run with 404', async () => {
    await expect(harness.service.submitPackage(UNKNOWN_ID, ['x'], AUTHOR)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('open questions and comments', () => {
  it('refuses to answer a question twice', async () => {
    const version = await save('epics');
    const question = await harness.service.addOpenQuestion(
      version.id,
      { text: 'Q?', blocking: false },
      AUTHOR,
    );
    await harness.service.answerQuestion(question.id, { answer: 'A.' }, AUTHOR);

    await expect(
      harness.service.answerQuestion(question.id, { answer: 'Again.' }, AUTHOR),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it('refuses an unknown question or version with 404', async () => {
    await expect(
      harness.service.answerQuestion(UNKNOWN_ID, { answer: 'A.' }, AUTHOR),
    ).rejects.toThrow(NotFoundError);
    await expect(
      harness.service.addOpenQuestion(UNKNOWN_ID, { text: 'Q?', blocking: true }, AUTHOR),
    ).rejects.toThrow(NotFoundError);
    await expect(harness.service.addComment(UNKNOWN_ID, { body: 'Hi' }, AUTHOR)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('records comments and questions in the timeline', async () => {
    const version = await save('epics');
    await harness.service.addComment(
      version.id,
      { body: 'Looks good', anchor: { line: 2 } },
      REVIEWER,
    );
    await harness.service.addOpenQuestion(version.id, { text: 'Q?', blocking: false }, REVIEWER);

    const actions = (await harness.service.getTimeline(initiativeId)).map((event) => event.action);

    expect(actions.slice(-2)).toEqual(['comment.added', 'question.added']);
  });
});

describe('reading', () => {
  it('refuses an unknown Initiative with 404', async () => {
    await expect(harness.service.getInitiative(UNKNOWN_ID)).rejects.toThrow(NotFoundError);
    await expect(harness.service.getTimeline(UNKNOWN_ID)).rejects.toThrow(NotFoundError);
  });
});
