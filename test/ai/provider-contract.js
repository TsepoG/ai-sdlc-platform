// @ts-check
// Reusable contract suite: every ModelProvider (the stub now, vendor adapters later) must pass it.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/** @import { CompletionRequest, ModelProvider } from '../../src/ai/index.js' */

const contentBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({
    type: z.literal('tool_call'),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ type: z.literal('json'), value: z.unknown() }),
]);

const countSchema = z.number().int().nonnegative();

const completionResultSchema = z.strictObject({
  content: z.array(contentBlockSchema),
  stopReason: z.enum(['end', 'tool_call', 'max_tokens', 'error']),
  usage: z.strictObject({
    inputTokens: countSchema,
    outputTokens: countSchema,
    costUsd: z.number().nonnegative().finite(),
  }),
  provider: z.string().min(1),
  model: z.string().min(1),
});

const capabilitiesSchema = z.strictObject({
  toolUse: z.boolean(),
  structuredOutput: z.boolean(),
  maxContextTokens: z.number().int().positive(),
});

/**
 * A small synthetic request; no real company data.
 * @param {string} model Model ID.
 * @param {Partial<CompletionRequest>} [overrides] Fields to replace.
 * @returns {CompletionRequest} Request.
 */
function syntheticRequest(model, overrides = {}) {
  return {
    model,
    system: 'You are a test fixture.',
    messages: [{ role: 'user', content: 'Reply with a short greeting.' }],
    maxTokens: 64,
    metadata: { initiativeId: 'init-test', stageKey: 'brief', agentRunId: 'run-test' },
    ...overrides,
  };
}

/**
 * Freeze a request deeply so a provider that mutates it fails loudly.
 * @template T
 * @param {T} value Plain data.
 * @returns {T} The same value, frozen.
 */
function freezeDeep(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

/**
 * Register the ModelProvider contract tests for a provider.
 * @param {() => ModelProvider | Promise<ModelProvider>} makeProvider Creates a fresh provider per test.
 * @param {{ model?: string }} [options] Model ID to call (adapters pass a real one).
 * @returns {void}
 */
export function runModelProviderContract(makeProvider, { model = 'contract-model' } = {}) {
  describe('ModelProvider contract', () => {
    it('has a non-empty string id', async () => {
      const provider = await makeProvider();

      expect(provider.id).toEqual(expect.any(String));
      expect(provider.id.length).toBeGreaterThan(0);
    });

    it('describes the capabilities of a model', async () => {
      const provider = await makeProvider();

      expect(() => capabilitiesSchema.parse(provider.capabilities(model))).not.toThrow();
    });

    it('returns a well-formed completion result', async () => {
      const provider = await makeProvider();

      const result = await provider.complete(syntheticRequest(model));

      expect(() => completionResultSchema.parse(result)).not.toThrow();
    });

    it('reports its own id and the requested model', async () => {
      const provider = await makeProvider();

      const result = await provider.complete(syntheticRequest(model));

      expect(result).toMatchObject({ provider: provider.id, model });
    });

    it('does not mutate the request', async () => {
      const provider = await makeProvider();
      const request = freezeDeep(syntheticRequest(model));

      await expect(provider.complete(request)).resolves.toBeDefined();
    });

    it('returns a json block when structured output is requested and supported', async () => {
      const provider = await makeProvider();
      if (!provider.capabilities(model).structuredOutput) {
        return;
      }
      const outputSchema = { type: 'object', properties: { greeting: { type: 'string' } } };

      const result = await provider.complete(syntheticRequest(model, { outputSchema }));

      expect(result.content.some((block) => block.type === 'json')).toBe(true);
    });
  });
}
