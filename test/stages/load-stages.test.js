// @ts-check
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadStages } from '../../src/stages/index.js';
import { issuesFromAsync, stageDoc, toYaml } from './helpers.js';

/** @type {string} */
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stages-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Write stage documents into the temporary directory.
 * @param {Record<string, Record<string, unknown>>} files File name to stage document.
 * @returns {Promise<void>} Resolves when written.
 */
async function writeStages(files) {
  for (const [name, doc] of Object.entries(files)) {
    await writeFile(join(dir, name), toYaml(doc));
  }
}

/** Two valid stages where `beta` consumes `alpha-doc` and can rework to `alpha`. */
function validPair() {
  return {
    '01-alpha.yaml': stageDoc(),
    '02-beta.yaml': stageDoc({
      key: 'beta',
      name: 'Beta',
      order: 2,
      requiredInputs: [{ type: 'alpha-doc', fromStage: 'alpha' }],
      outputs: ['beta-doc'],
      reworkTargets: ['alpha'],
    }),
  };
}

describe('loadStages', () => {
  it('loads every YAML file sorted by order', async () => {
    const files = validPair();
    await writeStages({ '01-z.yaml': files['02-beta.yaml'], '02-a.yaml': files['01-alpha.yaml'] });

    const stages = await loadStages(dir);

    expect(stages.map((stage) => stage.key)).toEqual(['alpha', 'beta']);
  });

  it('returns a frozen array', async () => {
    await writeStages(validPair());

    expect(Object.isFrozen(await loadStages(dir))).toBe(true);
  });

  it('ignores files that are not .yaml', async () => {
    await writeStages(validPair());
    await writeFile(join(dir, 'README.md'), 'not a stage');

    expect(await loadStages(dir)).toHaveLength(2);
  });

  it('fails when the directory does not exist', async () => {
    const missing = join(dir, 'missing');

    const issues = await issuesFromAsync(loadStages(missing));

    expect(issues).toEqual([expect.objectContaining({ source: missing, path: '(root)' })]);
  });

  it('fails when the directory holds no stage files', async () => {
    const issues = await issuesFromAsync(loadStages(dir));

    expect(issues).toEqual([expect.objectContaining({ source: dir, path: '(root)' })]);
  });

  it('names a stage file that cannot be read', async () => {
    await writeStages(validPair());
    await mkdir(join(dir, '03-folder.yaml'));

    const issues = await issuesFromAsync(loadStages(dir));

    expect(issues).toEqual([expect.objectContaining({ source: '03-folder.yaml', path: '(root)' })]);
  });

  it('reports problems from every invalid file together', async () => {
    await writeStages({
      '01-alpha.yaml': stageDoc({ key: 'Bad' }),
      '02-beta.yaml': stageDoc({ key: 'beta', order: 0 }),
    });

    const issues = await issuesFromAsync(loadStages(dir));

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: '01-alpha.yaml', path: 'key' }),
        expect.objectContaining({ source: '02-beta.yaml', path: 'order' }),
      ]),
    );
  });

  describe('cross-stage rules', () => {
    it('rejects a duplicate order', async () => {
      const files = validPair();
      files['02-beta.yaml'].order = 1;
      files['02-beta.yaml'].requiredInputs = [];
      files['02-beta.yaml'].reworkTargets = [];
      await writeStages(files);

      const issues = await issuesFromAsync(loadStages(dir));

      expect(issues).toContainEqual(
        expect.objectContaining({ source: '02-beta.yaml', path: 'order' }),
      );
    });

    it('rejects a duplicate stage key', async () => {
      const files = validPair();
      files['02-beta.yaml'].key = 'alpha';
      files['02-beta.yaml'].requiredInputs = [];
      files['02-beta.yaml'].reworkTargets = [];
      await writeStages(files);

      const issues = await issuesFromAsync(loadStages(dir));

      expect(issues).toContainEqual(
        expect.objectContaining({ source: '02-beta.yaml', path: 'key' }),
      );
    });

    it('rejects a fromStage that names an unknown stage', async () => {
      const files = validPair();
      files['02-beta.yaml'].requiredInputs = [{ type: 'alpha-doc', fromStage: 'gamma' }];
      await writeStages(files);

      const issues = await issuesFromAsync(loadStages(dir));

      expect(issues).toContainEqual(
        expect.objectContaining({ source: '02-beta.yaml', path: 'requiredInputs.0.fromStage' }),
      );
    });

    it('rejects a fromStage that points forward', async () => {
      const files = validPair();
      files['01-alpha.yaml'].requiredInputs = [{ type: 'beta-doc', fromStage: 'beta' }];
      await writeStages(files);

      const issues = await issuesFromAsync(loadStages(dir));

      expect(issues).toContainEqual(
        expect.objectContaining({ source: '01-alpha.yaml', path: 'requiredInputs.0.fromStage' }),
      );
    });

    it('rejects a fromStage that points at its own stage', async () => {
      const files = validPair();
      files['01-alpha.yaml'].requiredInputs = [{ type: 'alpha-doc', fromStage: 'alpha' }];
      await writeStages(files);

      const issues = await issuesFromAsync(loadStages(dir));

      expect(issues).toContainEqual(
        expect.objectContaining({ source: '01-alpha.yaml', path: 'requiredInputs.0.fromStage' }),
      );
    });

    it('rejects a fromStage whose stage does not output the input type', async () => {
      const files = validPair();
      files['02-beta.yaml'].requiredInputs = [{ type: 'other-doc', fromStage: 'alpha' }];
      await writeStages(files);

      const issues = await issuesFromAsync(loadStages(dir));

      expect(issues).toContainEqual(
        expect.objectContaining({ source: '02-beta.yaml', path: 'requiredInputs.0.type' }),
      );
    });

    it('rejects a rework target that names an unknown stage', async () => {
      const files = validPair();
      files['02-beta.yaml'].reworkTargets = ['gamma'];
      await writeStages(files);

      const issues = await issuesFromAsync(loadStages(dir));

      expect(issues).toContainEqual(
        expect.objectContaining({ source: '02-beta.yaml', path: 'reworkTargets.0' }),
      );
    });

    it('rejects a rework target that points forward', async () => {
      const files = validPair();
      files['01-alpha.yaml'].reworkTargets = ['beta'];
      await writeStages(files);

      const issues = await issuesFromAsync(loadStages(dir));

      expect(issues).toContainEqual(
        expect.objectContaining({ source: '01-alpha.yaml', path: 'reworkTargets.0' }),
      );
    });
  });
});
