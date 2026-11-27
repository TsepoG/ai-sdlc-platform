// @ts-check

/** @import { StageDefinition } from './types.js' */
/** @import { StageConfigIssue } from '../errors/index.js' */

/**
 * @typedef {object} SourcedStage
 * @property {string} source File the stage came from.
 * @property {StageDefinition} stage The parsed stage.
 */

/**
 * Check the rules that span stages: unique order and key, and inputs and rework targets that
 * point only at earlier, real stages.
 * @param {SourcedStage[]} entries Parsed stages with their files.
 * @returns {StageConfigIssue[]} Every problem found; empty when the set is valid.
 */
export function crossCheckStages(entries) {
  /** @type {Map<string, StageDefinition>} */
  const byKey = new Map();
  /** @type {StageConfigIssue[]} */
  const issues = [];
  const orders = new Set();
  for (const { source, stage } of entries) {
    if (orders.has(stage.order)) {
      issues.push({ source, path: 'order', message: `Duplicate order ${stage.order}` });
    }
    orders.add(stage.order);
    if (byKey.has(stage.key)) {
      issues.push({ source, path: 'key', message: `Duplicate stage key "${stage.key}"` });
    } else {
      byKey.set(stage.key, stage);
    }
  }
  for (const entry of entries) {
    issues.push(...checkInputs(entry, byKey), ...checkReworkTargets(entry, byKey));
  }
  return issues;
}

/**
 * Find the stage named `key` if it comes before `stage`; otherwise describe why not.
 * @param {StageDefinition} stage Stage making the reference.
 * @param {string} key Referenced stage key.
 * @param {Map<string, StageDefinition>} byKey All stages by key.
 * @returns {{ target: StageDefinition } | { problem: string }} The earlier stage, or the problem.
 */
function earlierStage(stage, key, byKey) {
  const target = byKey.get(key);
  if (target === undefined) {
    return { problem: `Unknown stage "${key}"` };
  }
  if (target.order >= stage.order) {
    return { problem: `Stage "${key}" does not come before "${stage.key}"` };
  }
  return { target };
}

/**
 * Check each required input's `fromStage` is an earlier stage that outputs the input's type.
 * @param {SourcedStage} entry Stage to check.
 * @param {Map<string, StageDefinition>} byKey All stages by key.
 * @returns {StageConfigIssue[]} Problems found.
 */
function checkInputs({ source, stage }, byKey) {
  /** @type {StageConfigIssue[]} */
  const issues = [];
  stage.requiredInputs.forEach((input, index) => {
    if (input.fromStage === undefined) {
      return;
    }
    const found = earlierStage(stage, input.fromStage, byKey);
    if ('problem' in found) {
      issues.push({ source, path: `requiredInputs.${index}.fromStage`, message: found.problem });
    } else if (!found.target.outputs.includes(input.type)) {
      issues.push({
        source,
        path: `requiredInputs.${index}.type`,
        message: `Stage "${input.fromStage}" does not output "${input.type}"`,
      });
    }
  });
  return issues;
}

/**
 * Check each rework target is an earlier stage.
 * @param {SourcedStage} entry Stage to check.
 * @param {Map<string, StageDefinition>} byKey All stages by key.
 * @returns {StageConfigIssue[]} Problems found.
 */
function checkReworkTargets({ source, stage }, byKey) {
  return stage.reworkTargets.flatMap((target, index) => {
    const found = earlierStage(stage, target, byKey);
    return 'problem' in found
      ? [{ source, path: `reworkTargets.${index}`, message: found.problem }]
      : [];
  });
}
