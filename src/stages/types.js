// @ts-check
// Shared stage shapes. The Zod schema in schema.js validates files into these types.

/**
 * @typedef {object} StageInput
 * @property {string} type Artifact type the stage needs.
 * @property {string} [fromStage] Stage that outputs it; absent for inputs from outside the workflow.
 */

/**
 * @typedef {object} ActionStep
 * @property {string} key Step key, unique in the stage.
 * @property {'action'} type Automated step.
 * @property {string} [condition] `initiative.flags.<name>`; the step runs only when the flag is true.
 * @property {{ workflow: string, environment: string }} action GitHub Actions workflow and target environment.
 */

/**
 * @typedef {object} WorkStep
 * @property {string} key Step key, unique in the stage.
 * @property {'work'} type People or the agent do something.
 * @property {string} [condition] `initiative.flags.<name>`; the step runs only when the flag is true.
 * @property {string} [assigneeRole] Role that does the work.
 * @property {boolean} [agentDrafts] True when the stage agent drafts the step's artifacts.
 * @property {string} [output] Artifact type the step produces; one of the stage's outputs.
 */

/**
 * @typedef {object} GateStep
 * @property {string} key Step key, unique in the stage.
 * @property {'gate'} type Approval by a role.
 * @property {string} [condition] `initiative.flags.<name>`; the step runs only when the flag is true.
 * @property {string} approverRole Role that decides the gate.
 * @property {number} [slaHours] Hours before the gate is overdue.
 */

/** @typedef {ActionStep | WorkStep | GateStep} StepDefinition */

/**
 * @typedef {object} StageDefinition
 * @property {string} key Stage key (lowercase slug).
 * @property {string} name Display name.
 * @property {number} order Position in the workflow, unique and positive.
 * @property {boolean} enabled Whether Initiatives can enter the stage.
 * @property {ReadonlyArray<StageInput>} requiredInputs Approved artifacts the stage needs.
 * @property {ReadonlyArray<string>} outputs Artifact types the stage produces.
 * @property {string} agent Stage agent key.
 * @property {ReadonlyArray<StepDefinition>} steps Ordered steps.
 * @property {ReadonlyArray<string>} reworkTargets Earlier stages a rejection or failure may return to.
 */

export {};
