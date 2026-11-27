// @ts-check
import { z } from 'zod';
import { ValidationError } from '../../errors/index.js';

const MAX_TITLE = 300;
const MAX_TEXT = 200_000;

const text = z.string().min(1).max(MAX_TEXT);
const uuid = z.uuid();

/** Path parameter `:id`. */
export const idParams = z.strictObject({ id: uuid });

/** POST /initiatives */
export const createInitiativeBody = z.strictObject({
  title: z.string().min(1).max(MAX_TITLE),
  request: text,
  notes: text.optional(),
  flags: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), z.boolean()).optional(),
});

/** POST /artifacts/:id/versions */
export const saveVersionBody = z.strictObject({
  content: text,
  format: z.enum(['markdown', 'text', 'json']).optional(),
  sourceVersionIds: z.array(uuid).optional(),
});

/** POST /stage-runs/:id/packages */
export const submitPackageBody = z.strictObject({ versionIds: z.array(uuid).min(1) });

/** POST /gate-runs/:id/decisions */
export const decisionBody = z.strictObject({
  outcome: z.enum(['approve', 'request_changes', 'reject']),
  packageHash: z.string().regex(/^[0-9a-f]{64}$/),
  reworkTarget: z.string().min(1).optional(),
  feedback: text.optional(),
});

/** POST /open-questions/:id/answer */
export const answerBody = z.strictObject({ answer: text });

/**
 * Validate request input at the boundary.
 * @template {z.ZodType} S
 * @param {S} schema Zod schema.
 * @param {unknown} input Body or params.
 * @returns {z.infer<S>} Validated input.
 * @throws {ValidationError} Naming each failing field, never echoing values.
 */
export function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.') || '(body)');
    throw new ValidationError(`Invalid request: ${[...new Set(fields)].join(', ')}`);
  }
  return result.data;
}
