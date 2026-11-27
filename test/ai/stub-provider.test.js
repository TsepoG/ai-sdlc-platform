// @ts-check
import { describe, expect, it } from 'vitest';
import { createStubProvider } from '../../src/ai/index.js';
import { runModelProviderContract } from './provider-contract.js';

/** @import { CompletionRequest } from '../../src/ai/index.js' */

/** @type {CompletionRequest} */
const REQUEST = {
  model: 'stub-model',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 32,
  metadata: { initiativeId: 'init-1', stageKey: 'brief', agentRunId: 'run-1' },
};

runModelProviderContract(() => createStubProvider());

describe('createStubProvider', () => {
  it('uses the id "stub" by default', () => {
    expect(createStubProvider().id).toBe('stub');
  });

  it('accepts a custom id', () => {
    expect(createStubProvider({ id: 'backup' }).id).toBe('backup');
  });

  it('returns the same text for the same request', async () => {
    const provider = createStubProvider();

    const first = await provider.complete(REQUEST);
    const second = await provider.complete(REQUEST);

    expect(second).toEqual(first);
    expect(first.content).toEqual([{ type: 'text', text: expect.any(String) }]);
  });

  it('returns a json block with the reply value when outputSchema is set', async () => {
    const provider = createStubProvider({ reply: () => ({ title: 'Draft' }) });

    const result = await provider.complete({ ...REQUEST, outputSchema: { type: 'object' } });

    expect(result.content).toEqual([{ type: 'json', value: { title: 'Draft' } }]);
  });

  it('returns an empty object as json by default when outputSchema is set', async () => {
    const result = await createStubProvider().complete({ ...REQUEST, outputSchema: {} });

    expect(result.content).toEqual([{ type: 'json', value: {} }]);
  });

  it('uses a string reply as the text', async () => {
    const provider = createStubProvider({ reply: (request) => `model=${request.model}` });

    const result = await provider.complete(REQUEST);

    expect(result.content).toEqual([{ type: 'text', text: 'model=stub-model' }]);
  });

  it('serialises a non-string reply as JSON text when no outputSchema is set', async () => {
    const provider = createStubProvider({ reply: () => ({ a: 1 }) });

    const result = await provider.complete(REQUEST);

    expect(result.content).toEqual([{ type: 'text', text: '{"a":1}' }]);
  });

  it('reports zero usage and cost', async () => {
    const result = await createStubProvider().complete(REQUEST);

    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(result.stopReason).toBe('end');
  });

  it('records every request in order as a copy', async () => {
    const provider = createStubProvider();
    const second = { ...REQUEST, model: 'other-model' };

    await provider.complete(REQUEST);
    await provider.complete(second);

    expect(provider.requests).toEqual([REQUEST, second]);
    expect(provider.requests[0]).not.toBe(REQUEST);
  });

  it('exposes the recorded requests read-only', async () => {
    const provider = createStubProvider();
    await provider.complete(REQUEST);

    expect(Object.isFrozen(provider.requests)).toBe(true);
  });

  it('reports structured output but no tool use', () => {
    expect(createStubProvider().capabilities('stub-model')).toMatchObject({
      toolUse: false,
      structuredOutput: true,
    });
  });
});
