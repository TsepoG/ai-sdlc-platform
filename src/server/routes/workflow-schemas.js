// @ts-check
import { z } from 'zod';
import { ValidationError } from '../../errors/index.js';

const MAX_TITLE = 300;
const MAX_TEXT = 200_000;

/**
 * Text PostgreSQL can store: no NUL characters and no lone UTF-16 surrogates. Either would make
 * the insert fail with a 500; refusing them here gives the caller a 400 instead.
 * @param {string} value Text.
 * @returns {boolean} True when storable.
 */
const storable = (value) => !value.includes('\u0000') && value.isWellFormed();
const STORABLE_MESSAGE = 'Must not contain NUL characters or unpaired surrogates';

/**
 * A storable string of bounded length.
 * @param {number} max Maximum length.
 * @returns {z.ZodString} Schema.
 */
const safeText = (max) => z.string().min(1).max(max).refine(storable, STORABLE_MESSAGE);

const text = safeText(MAX_TEXT);
const uuid = z.uuid();

/** Path parameter `:id`. */
export const idParams = z.strictObject({ id: uuid });

/** POST /initiatives */
export const createInitiativeBody = z.strictObject({
  title: safeText(MAX_TITLE),
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
  reworkTarget: safeText(MAX_TITLE).optional(),
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
