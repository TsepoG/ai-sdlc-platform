// @ts-check
import { createInitiative } from './create.js';
import { decide } from './decide.js';
import { submitPackage } from './packages.js';
import { getInitiative, getTimeline } from './queries.js';
import { addComment, addOpenQuestion, answerQuestion } from './questions.js';
import { getVersion, saveVersion } from './versions.js';

/** @typedef {import('./context.js').Actor} Actor */
/** @typedef {import('./context.js').WorkflowDeps} WorkflowDeps */
/** @typedef {import('./create.js').CreateInitiativeInput} CreateInitiativeInput */
/** @typedef {import('./versions.js').SaveVersionInput} SaveVersionInput */
/** @typedef {import('./versions.js').VersionView} VersionView */
/** @typedef {import('./decide.js').DecideInput} DecideInput */
/** @typedef {import('./decide.js').DecisionResult} DecisionResult */
/** @typedef {import('./packages.js').SubmittedPackage} SubmittedPackage */
/** @typedef {import('./queries.js').InitiativeView} InitiativeView */

/**
 * @typedef {object} WorkflowService
 * @property {(input: CreateInitiativeInput, actor: Actor) => Promise<{ id: string, key: string }>} createInitiative
 *   Create an Initiative and start its first stage.
 * @property {(artifactId: string, input: SaveVersionInput, actor: Actor) => Promise<VersionView>} saveVersion
 *   Save content as a new immutable version.
 * @property {(versionId: string) => Promise<VersionView & { content: string }>} getVersion
 *   Read a version with its content.
 * @property {(stageRunId: string, versionIds: string[], actor: Actor) => Promise<SubmittedPackage>} submitPackage
 *   Submit versions for review.
 * @property {(gateRunId: string, input: DecideInput, actor: Actor, roles: ReadonlyArray<string>) => Promise<DecisionResult>} decide
 *   Decide a gate.
 * @property {(versionId: string, input: { text: string, blocking: boolean }, actor: Actor) => Promise<{ id: string }>} addOpenQuestion
 *   Raise an open question on a version.
 * @property {(questionId: string, input: { answer: string }, actor: Actor) => Promise<{ id: string }>} answerQuestion
 *   Answer an open question.
 * @property {(versionId: string, input: { body: string, anchor?: Record<string, unknown> }, actor: Actor) => Promise<{ id: string }>} addComment
 *   Comment on a version.
 * @property {(initiativeId: string) => Promise<InitiativeView>} getInitiative
 *   Read an Initiative with its stage runs.
 * @property {(initiativeId: string) => Promise<import('../audit/index.js').StoredAuditEvent[]>} getTimeline
 *   The Initiative's audit trail.
 */

/**
 * Create the workflow service: every operation loads state, asks the Phase 01 rules what
 * happens, and writes the result with its audit events in one transaction.
 * @param {{ pool: import('pg').Pool, stages: ReadonlyArray<import('../stages/index.js').StageDefinition>, contentStore: import('../content/index.js').ContentStore, now?: () => Date }} deps
 *   Pool, loaded stages, content store and clock.
 * @returns {WorkflowService} The workflow service.
 */
export function createWorkflowService({ pool, stages, contentStore, now = () => new Date() }) {
  return bindService({ pool, stages, contentStore, now });
}

/**
 * Bind every operation to its dependencies.
 * @param {WorkflowDeps} deps Dependencies.
 * @returns {WorkflowService} Bound operations.
 */
function bindService(deps) {
  return {
    createInitiative: (input, actor) => createInitiative(deps, input, actor),
    saveVersion: (artifactId, input, actor) => saveVersion(deps, artifactId, input, actor),
    getVersion: (versionId) => getVersion(deps, versionId),
    submitPackage: (stageRunId, versionIds, actor) =>
      submitPackage(deps, stageRunId, versionIds, actor),
    decide: (gateRunId, input, actor, roles) => decide(deps, gateRunId, input, actor, roles),
    addOpenQuestion: (versionId, input, actor) => addOpenQuestion(deps, versionId, input, actor),
    answerQuestion: (questionId, input, actor) => answerQuestion(deps, questionId, input, actor),
    addComment: (versionId, input, actor) => addComment(deps, versionId, input, actor),
    getInitiative: (initiativeId) => getInitiative(deps, initiativeId),
    getTimeline: (initiativeId) => getTimeline(deps, initiativeId),
  };
}
