// @ts-check

/** @import { CompletionRequest, CompletionResult, ContentBlock, ModelProvider, ProviderCapabilities } from './contracts.js' */

const DEFAULT_STUB_ID = 'stub';
const DEFAULT_TEXT_REPLY = 'Stub reply.';
/** Nominal context size so callers that budget tokens have a number to work with. */
const STUB_MAX_CONTEXT_TOKENS = 200_000;

/**
 * @typedef {object} StubProviderOptions
 * @property {string} [id] Provider ID (default `stub`).
 * @property {(request: CompletionRequest) => unknown} [reply] Produces the reply: the json value
 *   when `outputSchema` is set, otherwise the text (non-strings are serialised as JSON).
 */

/**
 * @typedef {ModelProvider & { readonly requests: ReadonlyArray<CompletionRequest> }} StubProvider
 *   A ModelProvider that also exposes the requests it received.
 */

/**
 * Build the content blocks for a stub reply.
 * @param {CompletionRequest} request Request being answered.
 * @param {StubProviderOptions['reply']} reply Optional reply function.
 * @returns {ContentBlock[]} One json or text block.
 */
function replyContent(request, reply) {
  if (request.outputSchema !== undefined) {
    return [{ type: 'json', value: reply === undefined ? {} : reply(request) }];
  }
  if (reply === undefined) {
    return [{ type: 'text', text: DEFAULT_TEXT_REPLY }];
  }
  const value = reply(request);
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
}

/**
 * Create a deterministic, offline ModelProvider for tests and for running without a real model.
 * It records every request and reports zero usage and cost.
 * @param {StubProviderOptions} [options] ID and reply function.
 * @returns {StubProvider} The stub provider.
 */
export function createStubProvider({ id = DEFAULT_STUB_ID, reply } = {}) {
  /** @type {CompletionRequest[]} */
  const requests = [];
  /** @type {ProviderCapabilities} */
  const capabilities = Object.freeze({
    toolUse: false,
    structuredOutput: true,
    maxContextTokens: STUB_MAX_CONTEXT_TOKENS,
  });
  return {
    id,
    get requests() {
      return Object.freeze([...requests]);
    },
    async complete(request) {
      requests.push(structuredClone(request));
      /** @type {CompletionResult} */
      const result = {
        content: replyContent(request, reply),
        stopReason: 'end',
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        provider: id,
        model: request.model,
      };
      return result;
    },
    capabilities() {
      return { ...capabilities };
    },
  };
}
