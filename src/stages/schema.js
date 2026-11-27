// @ts-check
import { z } from 'zod';

/** Lowercase slug: letters and digits in hyphen-separated words, starting with a letter. */
export const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** The only condition form: `initiative.flags.<name>`, where name is a camelCase identifier. */
export const CONDITION_PATTERN = /^initiative\.flags\.([a-zA-Z][a-zA-Z0-9]*)$/;
/** A GitHub Actions workflow file name (no path), e.g. `deploy.yml`. */
const WORKFLOW_FILE_PATTERN = /^[a-zA-Z0-9][\w.-]*\.yml$/;

const slug = z
  .string()
  .regex(SLUG_PATTERN, { error: 'Must be a lowercase slug, e.g. tech-design' });
const condition = z
  .string()
  .regex(CONDITION_PATTERN, { error: 'Must be exactly initiative.flags.<name>' });

const actionStepSchema = z.strictObject({
  key: slug,
  type: z.literal('action'),
  condition: condition.optional(),
  action: z.strictObject({
    workflow: z
      .string()
      .regex(WORKFLOW_FILE_PATTERN, { error: 'Must be a workflow file name ending in .yml' }),
    environment: slug,
  }),
});

const workStepSchema = z.strictObject({
  key: slug,
  type: z.literal('work'),
  condition: condition.optional(),
  assigneeRole: slug.optional(),
  agentDrafts: z.boolean().optional(),
  output: slug.optional(),
});

const gateStepSchema = z.strictObject({
  key: slug,
  type: z.literal('gate'),
  condition: condition.optional(),
  approverRole: slug,
  slaHours: z.number().int().positive().optional(),
});

const stepSchema = z.discriminatedUnion('type', [actionStepSchema, workStepSchema, gateStepSchema]);

/** @typedef {z.infer<typeof stepSchema>} ParsedStep */

/**
 * Add the rules that span a stage's steps: unique keys, outputs listed, and ending in a gate.
 * @param {{ outputs: string[], steps: ParsedStep[] }} stage Stage whose shape already parsed.
 * @param {z.core.$RefinementCtx} ctx Zod refinement context.
 * @returns {void}
 */
function checkSteps(stage, ctx) {
  const seen = new Set();
  stage.steps.forEach((step, index) => {
    if (seen.has(step.key)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate step key "${step.key}"`,
        path: ['steps', index, 'key'],
      });
    }
    seen.add(step.key);
    if (step.type === 'work' && step.output !== undefined && !stage.outputs.includes(step.output)) {
      ctx.addIssue({
        code: 'custom',
        message: `Output "${step.output}" is not in the stage's outputs`,
        path: ['steps', index, 'output'],
      });
    }
  });
  checkEndsInGate(stage.steps, ctx);
}

/**
 * Require at least one gate, a gate last, and a gate as the last unconditional step, so the
 * stage ends in an approval whichever conditions are true.
 * @param {ParsedStep[]} steps Steps in order.
 * @param {z.core.$RefinementCtx} ctx Zod refinement context.
 * @returns {void}
 */
function checkEndsInGate(steps, ctx) {
  if (!steps.some((step) => step.type === 'gate')) {
    ctx.addIssue({ code: 'custom', message: 'A stage needs at least one gate', path: ['steps'] });
    return;
  }
  const lastIndex = steps.length - 1;
  if (steps[lastIndex].type !== 'gate') {
    ctx.addIssue({
      code: 'custom',
      message: 'The last step must be a gate',
      path: ['steps', lastIndex],
    });
  }
  const lastUnconditional = steps.findLastIndex((step) => step.condition === undefined);
  if (lastUnconditional === -1) {
    ctx.addIssue({
      code: 'custom',
      message: 'A stage needs an unconditional gate',
      path: ['steps'],
    });
  } else if (steps[lastUnconditional].type !== 'gate') {
    ctx.addIssue({
      code: 'custom',
      message: 'The last unconditional step must be a gate',
      path: ['steps', lastUnconditional],
    });
  }
}

/** Zod schema for one stage file. */
export const stageSchema = z
  .strictObject({
    key: slug,
    name: z.string().min(1),
    order: z.number().int().positive(),
    enabled: z.boolean(),
    requiredInputs: z.array(z.strictObject({ type: slug, fromStage: slug.optional() })),
    outputs: z.array(slug).min(1),
    agent: slug,
    steps: z.array(stepSchema).min(1),
    reworkTargets: z.array(slug),
  })
  .superRefine(checkSteps);
