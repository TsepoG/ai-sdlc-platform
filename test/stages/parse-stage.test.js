// @ts-check
import { describe, expect, it } from 'vitest';
import { parseStage } from '../../src/stages/index.js';
import { issuesFrom, stageDoc, toYaml } from './helpers.js';

const SOURCE = '09-alpha.yaml';

/**
 * Parse a stage document and return the issues it raises.
 * @param {Record<string, unknown>} doc Stage document.
 * @returns {ReadonlyArray<import('../../src/errors/index.js').StageConfigIssue>} Issues raised.
 */
function issuesFor(doc) {
  return issuesFrom(() => parseStage(toYaml(doc), SOURCE));
}

/**
 * The stage document with one step replaced.
 * @param {number} index Step index.
 * @param {Record<string, unknown>} step Replacement step.
 * @returns {import('./helpers.js').StageDoc} Stage document.
 */
function withStep(index, step) {
  const doc = stageDoc();
  doc.steps[index] = step;
  return doc;
}

describe('parseStage', () => {
  it('returns the validated stage for a valid document', () => {
    const stage = parseStage(toYaml(stageDoc()), SOURCE);

    expect(stage.key).toBe('alpha');
    expect(stage.steps.map((step) => step.key)).toEqual(['draft', 'approve']);
  });

  it('returns a deeply frozen stage', () => {
    const stage = parseStage(toYaml(stageDoc()), SOURCE);

    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.steps)).toBe(true);
    expect(Object.isFrozen(stage.steps[0])).toBe(true);
  });

  it('accepts action steps and conditional steps', () => {
    const doc = stageDoc();
    doc.steps.unshift({
      key: 'deploy-x',
      type: 'action',
      action: { workflow: 'deploy.yml', environment: 'sit' },
      condition: 'initiative.flags.requiresX',
    });

    const stage = parseStage(toYaml(doc), SOURCE);

    expect(stage.steps[0]).toEqual({
      key: 'deploy-x',
      type: 'action',
      action: { workflow: 'deploy.yml', environment: 'sit' },
      condition: 'initiative.flags.requiresX',
    });
  });

  it('names the file when the YAML is malformed', () => {
    const issues = issuesFrom(() => parseStage('key: [unclosed', SOURCE));

    expect(issues).toEqual([expect.objectContaining({ source: SOURCE, path: '(root)' })]);
  });

  it('rejects a document that is not a mapping', () => {
    expect(issuesFrom(() => parseStage('- a\n- b\n', SOURCE))).toEqual([
      expect.objectContaining({ source: SOURCE, path: '(root)' }),
    ]);
  });

  it('reports every failing path, not only the first', () => {
    const issues = issuesFor(stageDoc({ key: 'Bad Key', order: 0 }));

    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['key', 'order']));
  });

  describe('per-stage rules', () => {
    it.each([
      ['a stage key that is not a lowercase slug', stageDoc({ key: 'Alpha_1' }), 'key'],
      ['an order of zero', stageDoc({ order: 0 }), 'order'],
      ['a non-integer order', stageDoc({ order: 1.5 }), 'order'],
      ['empty outputs', stageDoc({ outputs: [] }), 'outputs'],
      ['an unknown stage key', stageDoc({ colour: 'red' }), '(root)'],
      ['a missing name', stageDoc({ name: undefined }), 'name'],
      ['a non-slug rework target', stageDoc({ reworkTargets: ['Brief'] }), 'reworkTargets.0'],
      [
        'an unknown key on a required input',
        stageDoc({ requiredInputs: [{ type: 'x', from: 'y' }] }),
        'requiredInputs.0',
      ],
      [
        'a step key that is not a lowercase slug',
        withStep(0, { key: 'Draft Step', type: 'work' }),
        'steps.0.key',
      ],
      ['a duplicate step key', withStep(0, { key: 'approve', type: 'work' }), 'steps.1.key'],
      ['an unknown step type', withStep(0, { key: 'draft', type: 'meeting' }), 'steps.0.type'],
      [
        'an action step without action.workflow',
        withStep(0, { key: 'deploy', type: 'action', action: { environment: 'sit' } }),
        'steps.0.action.workflow',
      ],
      [
        'an action workflow that is not a .yml filename',
        withStep(0, {
          key: 'deploy',
          type: 'action',
          action: { workflow: 'deploy.yaml', environment: 'sit' },
        }),
        'steps.0.action.workflow',
      ],
      [
        'an action workflow that is a path',
        withStep(0, {
          key: 'deploy',
          type: 'action',
          action: { workflow: '../deploy.yml', environment: 'sit' },
        }),
        'steps.0.action.workflow',
      ],
      [
        'an action environment that is not a slug',
        withStep(0, {
          key: 'deploy',
          type: 'action',
          action: { workflow: 'deploy.yml', environment: 'SIT env' },
        }),
        'steps.0.action.environment',
      ],
      [
        'an action step without action',
        withStep(0, { key: 'deploy', type: 'action' }),
        'steps.0.action',
      ],
      [
        'a gate without approverRole',
        withStep(1, { key: 'approve', type: 'gate' }),
        'steps.1.approverRole',
      ],
      [
        'an unknown key on a step',
        withStep(0, { key: 'draft', type: 'work', approverRole: 'owner' }),
        'steps.0',
      ],
      [
        'slaHours of zero',
        withStep(1, { key: 'approve', type: 'gate', approverRole: 'owner', slaHours: 0 }),
        'steps.1.slaHours',
      ],
      [
        'negative slaHours',
        withStep(1, { key: 'approve', type: 'gate', approverRole: 'owner', slaHours: -4 }),
        'steps.1.slaHours',
      ],
      [
        'slaHours on a work step',
        withStep(0, { key: 'draft', type: 'work', slaHours: 4 }),
        'steps.0',
      ],
      [
        'a work output the stage does not list',
        withStep(0, { key: 'draft', type: 'work', output: 'other-doc' }),
        'steps.0.output',
      ],
      ['a stage with no steps', stageDoc({ steps: [] }), 'steps'],
    ])('rejects %s, naming the file and path', (_name, doc, path) => {
      const issues = issuesFor(doc);

      expect(issues).toContainEqual(expect.objectContaining({ source: SOURCE, path }));
    });

    it.each([
      'initiative.flags',
      'initiative.flags.',
      'initiative.flags.requires-preprod',
      'initiative.flags.a.b',
      'flags.requiresPreprod',
      'initiative.flags.requiresPreprod == true',
      '!initiative.flags.requiresPreprod',
      ' initiative.flags.requiresPreprod',
    ])('rejects the condition %j at load time', (condition) => {
      const doc = withStep(0, { key: 'draft', type: 'work', condition });

      expect(issuesFor(doc)).toContainEqual(
        expect.objectContaining({ source: SOURCE, path: 'steps.0.condition' }),
      );
    });

    it('rejects a stage with no gate', () => {
      const doc = stageDoc({ steps: [{ key: 'draft', type: 'work' }] });

      expect(issuesFor(doc)).toContainEqual(
        expect.objectContaining({
          source: SOURCE,
          path: 'steps',
          message: expect.stringMatching(/gate/),
        }),
      );
    });

    it('rejects a stage whose last step is not a gate', () => {
      const doc = stageDoc();
      doc.steps.push({ key: 'tidy-up', type: 'work' });

      expect(issuesFor(doc)).toContainEqual(
        expect.objectContaining({ source: SOURCE, path: 'steps.2' }),
      );
    });

    it('rejects a stage whose last unconditional step is not a gate', () => {
      const doc = stageDoc();
      doc.steps.splice(1, 0, { key: 'check', type: 'work' });
      doc.steps[2] = { ...doc.steps[2], condition: 'initiative.flags.requiresX' };

      expect(issuesFor(doc)).toContainEqual(
        expect.objectContaining({ source: SOURCE, path: 'steps.1' }),
      );
    });

    it('rejects a stage whose steps are all conditional', () => {
      const condition = 'initiative.flags.requiresX';
      const doc = stageDoc({
        steps: [
          { key: 'draft', type: 'work', condition },
          { key: 'approve', type: 'gate', approverRole: 'owner', condition },
        ],
      });

      expect(issuesFor(doc)).toContainEqual(
        expect.objectContaining({ source: SOURCE, path: 'steps' }),
      );
    });
  });
});
