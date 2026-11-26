# Phase 01 — Core rules

**Goal:** the rules that make the platform trustworthy exist as pure, fully
tested code, and every stage is described in configuration. Later phases
(database, Temporal, agents, web app) call these rules; they never re-implement
them.

**Branch:** `feat/phase-01-core-rules` · **Size:** about 1 week.

**Read first:** `docs/design/core-design.md` sections 2–7 and
`CODING_PRINCIPLES.md` §10 (platform rules).

## In scope

### 1. Stage configuration (`config/stages/`, `src/stages/`)

Seven YAML files, one per stage, named `NN-<key>.yaml`. **Only `brief` has
`enabled: true`.** Contents follow `core-design.md` §2 and §4:

| File                     | Steps, in order                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-brief.yaml`          | `draft-brief` (work, agent drafts) → `epic-approval` (gate, product-owner)                                                                                                                                                                                                                                                                       |
| `02-ux-design.yaml`      | `draft-designs` (work, agent drafts) → `validate-epic` (gate, ux-lead)                                                                                                                                                                                                                                                                           |
| `03-tech-design.yaml`    | `draft-design` (work, agent drafts) → `design-review` (gate, solution-architect) → `tdf-approval` (gate, tdf-forum, condition `initiative.flags.requiresTdf`)                                                                                                                                                                                    |
| `04-work-breakdown.yaml` | `draft-stories` (work, agent drafts) → `refinement` (gate, tech-lead)                                                                                                                                                                                                                                                                            |
| `05-build.yaml`          | `code-and-test` (work, agent drafts; output pre-PR test results) → `pr-review` (gate, senior-engineer) → `deploy-dev` (action, env `dev`) → `dev-tests` (work) → `dev-verified` (gate, senior-engineer)                                                                                                                                          |
| `06-deploy.yaml`         | `draft-release-plan` (work, agent drafts) → `release-approval` (gate, release-manager)                                                                                                                                                                                                                                                           |
| `07-test.yaml`           | `deploy-sit` (action) → `sit-testing` (work, qa-lead) → `sit-signoff` (gate, qa-lead) → `deploy-uat` (action) → `uat-testing` (work, business-owner) → `uat-signoff` (gate, business-owner) → `deploy-preprod` / `preprod-checks` / `preprod-signoff` (all three with condition `initiative.flags.requiresPreprod`, sign-off by release-manager) |

Inputs, outputs, agents and rework targets as in `core-design.md` §2 and the
example YAML in §4. Rework targets: brief none; ux-design → brief;
tech-design → brief, ux-design; work-breakdown → tech-design;
build → work-breakdown; deploy → build; test → build, work-breakdown.

`src/stages` (public entry `index.js`):

- `parseStage(text, source)` — parse one YAML document and validate it with Zod;
  throws `StageConfigError` naming the file and every failing path.
- `loadStages(dir)` — read every `*.yaml`, parse, sort by `order`, then run the
  cross-stage checks below. Returns a frozen array.
- JSDoc typedefs `StageDefinition`, `StepDefinition` (action | work | gate),
  `StageInput`, owned here.

**Per-stage validation:**

- `key` and every step `key` are lowercase slugs; step keys unique in the stage.
- `order` is a positive integer; `outputs` has at least one entry.
- Step shapes: `action` needs `action.workflow` (a `.yml` filename) and
  `action.environment` (slug); `gate` needs `approverRole`; `work` may have
  `assigneeRole`, `agentDrafts`, `output`. Unknown keys are rejected.
- `slaHours` positive when present.
- `condition`, when present, matches `initiative.flags.<name>` exactly; anything
  else is rejected **at load time**, not when evaluated.
- At least one gate. The last step is a gate, and the last _unconditional_ step
  is a gate (so the stage ends in an approval whichever conditions are true).

**Cross-stage validation (`loadStages`):**

- `order` values are unique; stage keys are unique.
- Every `requiredInputs[].fromStage` names an existing stage with a lower
  `order`, and that stage lists the input's `type` in its `outputs`.
- Every `reworkTargets` entry names an existing stage with a lower `order`.

### 2. Workflow rules (`src/workflow/`) — pure functions, no I/O

- `evaluateCondition(condition, { flags })` → boolean. No condition → `true`.
- `plannedSteps(stage, { flags })` → `{ run, skipped }`, both in stage order.
- `nextMove(stage, { flags }, currentStepKey, outcome)` → the next move:

| Current step | Outcome                        | Next move                                                                 |
| ------------ | ------------------------------ | ------------------------------------------------------------------------- |
| any          | `done`                         | next planned step, or `stage_approved` after the last                     |
| gate         | `changes_requested`            | `restart` at the first planned step                                       |
| gate         | `rejected` with `reworkTarget` | `rework` to that stage (must be in `reworkTargets`)                       |
| gate         | `rejected` without target      | `cancelled`                                                               |
| action       | `failed`                       | `paused` at that step (retry or send back is a human decision)            |
| work         | `failed`                       | `rework` to the first `reworkTargets` entry, or `paused` if there is none |

Anything else — an outcome that doesn't fit the step type, a step that isn't
planned for these flags, a rework target not in the list — throws
`InvalidTransitionError`.

- `contentHash(text)` → SHA-256 hex (`node:crypto`) of the text with `\r\n`
  normalised to `\n`.
- `packageHash(versionHashes)` → SHA-256 hex over the hashes **sorted** and
  joined with `\n`. Throws on an empty list or a value that isn't 64 lowercase
  hex characters.
- `assertCurrentPackage(currentHash, decisionHash)` → throws
  `StalePackageError` (HTTP 409) on mismatch.
- `checkDecisionRights({ reviewerId, reviewerRoles, approverRole, packageAuthorIds })`
  → `{ allowed: true } | { allowed: false, reason: 'missing_role' | 'author_of_package' }`,
  and `assertCanDecide(...)` which throws `NotAuthorisedError` or
  `SeparationOfDutiesError` (both HTTP 403).

### 3. Vendor-neutral AI contracts (`src/ai/`)

- `contracts.js` — JSDoc typedefs only, matching `core-design.md` §7:
  `ModelProvider`, `CompletionRequest`, `CompletionResult`, `ContentBlock`,
  `Message`, `ToolSpec`, `Usage`, `ProviderCapabilities`, `CodingAgent`,
  `CodingTask`, `CodingResult`, `StageAgent`, `StageContext`, `DraftResult`,
  `RubricCheck`. No vendor names anywhere.
- `routing.js` — `parseRouting(text, vars)` validates `config/routing.yaml`
  with Zod and expands `${NAME}` from the injected `vars` map (never from
  `process.env`); a missing variable throws `RoutingError`.
  `createProviderRegistry(routing)` with `register(provider)`,
  `resolve(stageKey)` → `{ provider, model }` (stage route, else default, else
  the route's fallback) and `resolveFallback(stageKey)`; nothing registered →
  `RoutingError`.
- `stub-provider.js` — `createStubProvider({ id = 'stub', reply })`:
  deterministic, records every request, returns `json` content when
  `outputSchema` is set, zero usage and cost.
- `config/routing.yaml` — every stage routed to `stub` / `stub-model` until
  Phase 03 adds the first real adapter.
- `test/ai/provider-contract.js` — a reusable contract suite
  (`runModelProviderContract(makeProvider)`) that any `ModelProvider` must
  pass. The stub runs it now; the Claude adapter will run it in Phase 03.

### 4. Errors (`src/errors/`)

Add `StageConfigError`, `RoutingError`, `InvalidTransitionError`,
`StalePackageError` (409), `NotAuthorisedError` (403) and
`SeparationOfDutiesError` (403), each an `AppError` with a stable `code`.

### 5. Server (`src/server/`)

- Load and validate stage config **at startup**; the server refuses to start on
  invalid config (fail fast, logged with the `StageConfigError` details).
- `GET /stages` — read-only list: key, name, order, enabled, steps (key, type,
  condition). No other new routes.
- The `Dockerfile` copies `config/` into the image, so the deployed service
  proves the config loads. `STAGES_DIR` comes through `src/config`.

### 6. Docs

- `docs/decisions/0003-stage-config-as-yaml.md` — why YAML files in the repo
  (reviewed through PRs, versioned with the code) and why the `yaml` package.
- README: a short "Stage configuration" section (where it lives, how to change
  it, the validation rules, how to run the checks).

## Dependencies

- `yaml` — Node has no built-in YAML parser. Nothing else should be needed;
  justify anything more in the plan.

## Tests (`test/` mirrors `src/`)

- **Real config:** all seven files load; order is brief → … → test; only
  `brief` enabled.
- **Validation:** one failing case per rule above (duplicate step key, no gate,
  last step not a gate, bad condition syntax, unknown key, `fromStage` pointing
  forward or at a stage that doesn't output the type, rework target pointing
  forward, duplicate order). Each asserts the error names the file and path.
- **Test stage:** without `requiresPreprod` the run is the six SIT/UAT steps and
  three are skipped; with it, all nine run. Deploy to UAT comes only after SIT
  sign-off. UAT sign-off is the last step without preprod. A failed SIT test
  reworks to `build`. A failed deployment pauses. Changes requested at UAT
  restart at `deploy-sit`.
- **Tech design:** `tdf-approval` runs only with `requiresTdf`.
- **Brief:** approval after the single gate; rejection without target cancels;
  a failed draft pauses (no rework targets).
- **Invalid transitions:** `changes_requested` on a work step; `rejected` with a
  target not in the list; a skipped step as current step.
- **Hashing:** same text with CRLF and LF hashes the same; package hash ignores
  order; empty list and malformed hash throw; stale decision throws
  `StalePackageError`.
- **Duties:** author with the right role is refused; non-author without the
  role is refused; non-author with the role is allowed.
- **AI:** routing resolves stage route, default and fallback; missing `${VAR}`
  throws; the stub passes the provider contract suite.
- **Server:** `GET /stages`; startup fails on an invalid stages directory.
- **Lint boundary:** still proven (unchanged), and `src/ai` contains no vendor
  import.

## Out of scope (later phases)

Database, S3, Temporal, Initiative/version persistence, the audit log, the
_upstream changed_ rule (needs persistence — Phase 02), any vendor adapter,
the agent run loop, prompt templates, SSO, other API routes, the web app.

## Acceptance criteria

- [ ] All seven stage files load and validate; only Brief is enabled.
- [ ] Every rule in sections 1–2 has a test, including the error paths.
- [ ] `src/workflow` and `src/stages` are pure apart from file reading in
      `loadStages`; no `process.env`, no network.
- [ ] `src/ai` has the contracts, routing, stub provider and the reusable
      provider contract suite; no vendor SDK or vendor name.
- [ ] Server fails fast on invalid config and serves `GET /stages`; the Docker
      image includes `config/` and answers `/stages`.
- [ ] `npm run verify` and `npm run audit` pass; coverage ≥ 90% on all measures.
- [ ] ADR 0003 and the README section are written.
- [ ] No commits by Claude Code; a Conventional Commit message is proposed at
      each stop; after the owner pushes, the PR is opened with `gh pr create`.
- [ ] After merge, the automatic dev deploy succeeds and `GET /stages` on the
      dev load balancer returns the seven stages (if dev is running).
