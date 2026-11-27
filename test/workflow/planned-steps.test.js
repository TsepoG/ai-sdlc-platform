// @ts-check
import { beforeAll, describe, expect, it } from 'vitest';
import { plannedSteps } from '../../src/workflow/index.js';
import { realStage } from './real-stages.js';

/** @type {import('../../src/stages/index.js').StageDefinition} */
let test;
/** @type {import('../../src/stages/index.js').StageDefinition} */
let techDesign;

beforeAll(async () => {
  test = await realStage('test');
  techDesign = await realStage('tech-design');
});

/**
 * Step keys of a list of steps.
 * @param {ReadonlyArray<{ key: string }>} steps Steps.
 * @returns {string[]} Their keys.
 */
const keys = (steps) => steps.map((step) => step.key);

describe('plannedSteps', () => {
  it('runs the six SIT and UAT steps and skips preprod without requiresPreprod', () => {
    const { run, skipped } = plannedSteps(test, { flags: {} });

    expect(keys(run)).toEqual([
      'deploy-sit',
      'sit-testing',
      'sit-signoff',
      'deploy-uat',
      'uat-testing',
      'uat-signoff',
    ]);
    expect(keys(skipped)).toEqual(['deploy-preprod', 'preprod-checks', 'preprod-signoff']);
  });

  it('runs all nine test steps with requiresPreprod', () => {
    const { run, skipped } = plannedSteps(test, { flags: { requiresPreprod: true } });

    expect(run).toHaveLength(9);
    expect(skipped).toEqual([]);
  });

  it('plans deploy to UAT only after SIT sign-off', () => {
    const run = keys(plannedSteps(test, { flags: {} }).run);

    expect(run.indexOf('deploy-uat')).toBe(run.indexOf('sit-signoff') + 1);
  });

  it('runs tdf-approval only with requiresTdf', () => {
    expect(keys(plannedSteps(techDesign, { flags: {} }).run)).not.toContain('tdf-approval');
    expect(keys(plannedSteps(techDesign, { flags: { requiresTdf: true } }).run)).toContain(
      'tdf-approval',
    );
  });

  it('returns frozen lists', () => {
    const { run, skipped } = plannedSteps(test, { flags: {} });

    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(skipped)).toBe(true);
  });
});
