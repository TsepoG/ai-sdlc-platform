// @ts-check
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStages } from '../../src/stages/index.js';

const STAGES_DIR = join(import.meta.dirname, '../../config/stages');

describe('config/stages', () => {
  it('loads all seven stages in order brief to test', async () => {
    const stages = await loadStages(STAGES_DIR);

    expect(stages.map((stage) => stage.key)).toEqual([
      'brief',
      'ux-design',
      'tech-design',
      'work-breakdown',
      'build',
      'deploy',
      'test',
    ]);
  });

  it('enables only the brief stage', async () => {
    const stages = await loadStages(STAGES_DIR);

    expect(stages.filter((stage) => stage.enabled).map((stage) => stage.key)).toEqual(['brief']);
  });

  it.each([
    ['brief', []],
    ['ux-design', ['brief']],
    ['tech-design', ['brief', 'ux-design']],
    ['work-breakdown', ['tech-design']],
    ['build', ['work-breakdown']],
    ['deploy', ['build']],
    ['test', ['build', 'work-breakdown']],
  ])('gives %s the rework targets %j', async (key, targets) => {
    const stages = await loadStages(STAGES_DIR);

    expect(stages.find((stage) => stage.key === key)?.reworkTargets).toEqual(targets);
  });

  it.each([
    ['brief', ['draft-brief', 'epic-approval']],
    ['ux-design', ['draft-designs', 'validate-epic']],
    ['tech-design', ['draft-design', 'design-review', 'tdf-approval']],
    ['work-breakdown', ['draft-stories', 'refinement']],
    ['build', ['code-and-test', 'pr-review', 'deploy-dev', 'dev-tests', 'dev-verified']],
    ['deploy', ['draft-release-plan', 'release-approval']],
    [
      'test',
      [
        'deploy-sit',
        'sit-testing',
        'sit-signoff',
        'deploy-uat',
        'uat-testing',
        'uat-signoff',
        'deploy-preprod',
        'preprod-checks',
        'preprod-signoff',
      ],
    ],
  ])('gives %s the steps %j in order', async (key, steps) => {
    const stages = await loadStages(STAGES_DIR);

    expect(stages.find((stage) => stage.key === key)?.steps.map((step) => step.key)).toEqual(steps);
  });
});
