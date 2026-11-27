// @ts-check
import { expect } from 'vitest';
import { stringify } from 'yaml';
import { StageConfigError } from '../../src/errors/index.js';

/**
 * @typedef {{ steps: Record<string, unknown>[], [field: string]: unknown }} StageDoc
 *   A stage document as plain data; tests mutate it before serialising.
 */

/**
 * A minimal valid stage as a plain object, ready to mutate and serialise.
 * @param {Record<string, unknown>} [overrides] Top-level fields to replace.
 * @returns {StageDoc} Stage document.
 */
export function stageDoc(overrides = {}) {
  return {
    key: 'alpha',
    name: 'Alpha',
    order: 1,
    enabled: false,
    requiredInputs: [{ type: 'request' }],
    outputs: ['alpha-doc'],
    agent: 'alpha-agent',
    steps: [
      { key: 'draft', type: 'work', agentDrafts: true, assigneeRole: 'contributor' },
      { key: 'approve', type: 'gate', approverRole: 'owner', slaHours: 24 },
    ],
    reworkTargets: [],
    ...overrides,
  };
}

/**
 * Serialise a stage document to YAML text.
 * @param {Record<string, unknown>} doc Stage document.
 * @returns {string} YAML text.
 */
export function toYaml(doc) {
  return stringify(doc);
}

/**
 * Run `action`, expect a StageConfigError, and return its issues.
 * @param {() => unknown} action Code expected to throw.
 * @returns {ReadonlyArray<import('../../src/errors/index.js').StageConfigIssue>} Issues raised.
 */
export function issuesFrom(action) {
  /** @type {unknown} */
  let caught;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(StageConfigError);
  return /** @type {StageConfigError} */ (caught).issues;
}

/**
 * Await `promise`, expect it to reject with a StageConfigError, and return its issues.
 * @param {Promise<unknown>} promise Promise expected to reject.
 * @returns {Promise<ReadonlyArray<import('../../src/errors/index.js').StageConfigIssue>>} Issues raised.
 */
export async function issuesFromAsync(promise) {
  const error = await promise.then(
    () => undefined,
    (/** @type {unknown} */ reason) => reason,
  );
  expect(error).toBeInstanceOf(StageConfigError);
  return /** @type {StageConfigError} */ (error).issues;
}
