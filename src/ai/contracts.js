// @ts-check
// Vendor-neutral AI contracts (core-design.md section 7). Typedefs only: agents and the workflow
// depend on these shapes, and each vendor adapter under src/ai-adapters/<vendor>/ implements them.

/**
 * @typedef {object} Usage
 * @property {number} inputTokens Tokens sent to the model.
 * @property {number} outputTokens Tokens the model produced.
 * @property {number} costUsd Cost of the call in US dollars, from configured prices.
 */

/**
 * @typedef {{ type: 'text', text: string }
 *   | { type: 'tool_call', id: string, name: string, input: Record<string, unknown> }
 *   | { type: 'json', value: unknown }} ContentBlock
 *   One piece of model output: prose, a request to call a tool, or structured output.
 */

/**
 * @typedef {object} Message
 * @property {'user' | 'assistant'} role Who wrote the message.
 * @property {string | ContentBlock[]} content Plain text or content blocks.
 */

/**
 * @typedef {object} ToolSpec
 * @property {string} name Tool name the model uses to call it.
 * @property {string} description What the tool does, for the model.
 * @property {Record<string, unknown>} inputSchema JSON Schema of the tool's input.
 */

/**
 * @typedef {object} CompletionMetadata
 * @property {string} initiativeId Initiative the call is for.
 * @property {string} stageKey Stage the call is for.
 * @property {string} agentRunId Agent run that made the call.
 */

/**
 * @typedef {object} CompletionRequest
 * @property {string} model Model ID, from routing configuration.
 * @property {string} [system] System prompt.
 * @property {Message[]} messages Conversation so far.
 * @property {ToolSpec[]} [tools] Tools the model may call.
 * @property {Record<string, unknown>} [outputSchema] JSON Schema the output must follow (structured output).
 * @property {number} maxTokens Upper bound on output tokens.
 * @property {CompletionMetadata} metadata Where the call comes from, for audit and cost.
 */

/**
 * @typedef {object} CompletionResult
 * @property {ContentBlock[]} content Output blocks.
 * @property {'end' | 'tool_call' | 'max_tokens' | 'error'} stopReason Why the model stopped.
 * @property {Usage} usage Tokens and cost.
 * @property {string} provider ID of the provider that served the call.
 * @property {string} model Model that served the call.
 */

/**
 * @typedef {object} ProviderCapabilities
 * @property {boolean} toolUse Whether the model can call tools.
 * @property {boolean} structuredOutput Whether the model honours `outputSchema`.
 * @property {number} maxContextTokens Largest context the model accepts.
 */

/**
 * @typedef {object} ModelProvider
 * @property {string} id Provider ID used in routing configuration.
 * @property {(request: CompletionRequest) => Promise<CompletionResult>} complete Run one completion.
 * @property {(model: string) => ProviderCapabilities} capabilities What a model supports.
 */

/**
 * @typedef {object} CodingTask
 * @property {string} repo Repository to work in.
 * @property {string} baseBranch Branch to start from.
 * @property {string} workBranch Branch to commit to.
 * @property {string} instructions What to build.
 * @property {string[]} allowedCommands Commands the agent may run.
 * @property {number} timeoutMinutes Time limit for the run.
 */

/**
 * @typedef {object} CodingResult
 * @property {string[]} commits Commit SHAs the agent made on the work branch.
 * @property {string} testSummary Summary of the test run.
 * @property {'success' | 'tests_failed' | 'blocked' | 'error'} status How the run ended.
 * @property {string[]} questions Questions the agent needs answered.
 * @property {Usage} usage Tokens and cost.
 */

/**
 * @typedef {object} CodingAgent
 * @property {string} id Coding agent ID.
 * @property {(task: CodingTask) => Promise<CodingResult>} run Run a coding task.
 */

/**
 * @typedef {object} StageInputVersion
 * @property {string} type Artifact type.
 * @property {string} versionId Approved version used as input.
 * @property {string} contentHash Content hash of that version.
 * @property {string} content The version's content (untrusted data, never instructions).
 */

/**
 * @typedef {object} StageContext
 * @property {string} initiativeId Initiative being worked on.
 * @property {string} stageKey Stage being drafted.
 * @property {Readonly<Record<string, boolean>>} flags Initiative flags.
 * @property {StageInputVersion[]} inputs Approved upstream versions.
 * @property {string} templateVersion Prompt template version used.
 */

/**
 * @typedef {object} DraftArtifact
 * @property {string} type Artifact type, one of the stage's outputs.
 * @property {string} title Artifact title.
 * @property {string} content Drafted content.
 * @property {string} format Content format, e.g. `markdown`.
 */

/**
 * @typedef {object} DraftQuestion
 * @property {string} text The question.
 * @property {boolean} blocking Whether the stage waits for the answer.
 */

/**
 * @typedef {object} DraftResult
 * @property {DraftArtifact[]} artifacts Drafted artifacts.
 * @property {DraftQuestion[]} openQuestions Questions raised while drafting.
 * @property {Usage} usage Tokens and cost.
 */

/**
 * @typedef {object} RubricCheck
 * @property {string} id Rubric item ID.
 * @property {string} description What the item checks.
 * @property {boolean} passed Whether the draft meets it.
 * @property {string} [detail] Why it passed or failed.
 */

/**
 * @typedef {object} StageAgent
 * @property {string} key Agent key, as named in the stage configuration.
 * @property {string} version Agent version, recorded on each run.
 * @property {(context: StageContext) => Promise<DraftResult>} draft Draft the stage's artifacts.
 * @property {(draft: DraftResult, context: StageContext) => Promise<RubricCheck[]>} selfCheck
 *   Check a draft against the stage's rubric.
 */

export {};
