# Core Design

Repo copy of the "AI-Assisted SDLC Platform — Core Design & MVP" and
"Project Plan & System Design" docs, trimmed to what is needed to build the
platform. If this file and `CODING_PRINCIPLES.md` disagree on language or
tooling, the principles win (JavaScript + JSDoc, not TypeScript). If this file
disagrees with a phase file, stop and ask.

## 1. What the platform does

An internal workflow platform where a stage-specific AI agent drafts each SDLC
artifact and a named human approves the exact version before work moves on.

- **Unit of work:** an _Initiative_ (one feature or change request) carrying a
  versioned, traceable set of artifacts and approvals.
- **Seven stages, in order:** Brief → UX design → Tech design → Work breakdown →
  Build → Deploy → Test.
- **Lifecycle per stage:** draft → human review → changes requested or approved
  → handoff to the next stage.
- **Existing tools stay the systems of record:** Jira, Confluence, Figma and
  GitHub own their content. The platform owns workflow state, versions,
  decisions, links and the audit trail.
- **Toolset:** Jira, Confluence, Figma, GitHub, GitHub Actions, AWS, MS Teams.

## 2. Stages

| #   | Stage          | Inputs                              | Agent drafts                                                                                    | Approval                                                                               |
| --- | -------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 01  | Brief          | Business request, stakeholder notes | Feature hypothesis, user journeys, NFRs, epics                                                  | Epic approval · Product owner                                                          |
| 02  | UX design      | Epics, user journeys                | Figma wireframes and UI designs, UI prototype in the frontend app, BFF mock, prototype PR       | Validate epic · UX lead                                                                |
| 03  | Tech design    | Validated epic, Figma, NFRs         | Architecture design, E2E tech design, data model; TDF paper only for architecture-level changes | Design review · Solution architect (+ TDF approval forum when a TDF paper is required) |
| 04  | Work breakdown | Tech design, validated epic         | Stories, acceptance criteria, test cases                                                        | Refinement · Tech lead                                                                 |
| 05  | Build          | Stories and AC, test cases          | Code, tests, PR; tests run **before the PR** and again **in dev after merge**                   | PR review · Senior engineer                                                            |
| 06  | Deploy         | Build passing in dev                | Release plan for SIT, UAT, preprod; rollback plan                                               | Release approval · Release manager                                                     |
| 07  | Test           | Test cases, approved release plan   | Per environment: **deploy → test → sign-off** for SIT, then UAT, then preprod if required       | SIT · QA lead; UAT · Business owner; preprod · Release manager                         |

- Deployments into SIT, UAT and preprod are automated _action steps inside the
  Test stage_, triggered through GitHub Actions only after the previous
  environment is signed off.
- A failed test in any environment sends the Initiative back to Build; the new
  build restarts at SIT.
- **Production deployment is out of scope for now.**
- **TDF paper:** a paper used to present big changes that include architectural
  change or need approval at that level. Produced only when the Initiative flag
  `requiresTdf` is set.

## 3. Design principles

1. Stages are configuration, not engine code.
2. Approval binds to a content hash.
3. Versions are immutable once submitted.
4. Agents draft, people decide.
5. No AI vendor SDKs outside adapters.
6. Write downstream only from approved versions.
7. Everything is auditable (append-only, hash-chained).
8. Existing tools stay the systems of record.

## 4. Stage configuration

A stage is an ordered list of **steps**. Step types:

- `work` — people or the agent do something (draft the brief, run SIT tests).
- `action` — automated (trigger a GitHub Actions deployment to an environment).
- `gate` — approval by a role.

`condition` makes a step optional; today the only form is
`initiative.flags.<name>` (for example `requiresPreprod`, `requiresTdf`).

Validation rules: unique step keys; at least one gate; the last unconditional
step is a gate; every `fromStage` and `reworkTargets` entry names a real stage.

```yaml
# config/stages/07-test.yaml
key: test
name: Test
order: 7
enabled: false
requiredInputs:
  - { type: test-cases, fromStage: work-breakdown }
  - { type: release-plan, fromStage: deploy }
outputs: [sit-report, uat-report, preprod-report]
agent: test-agent
steps:
  - { key: deploy-sit, type: action, action: { workflow: deploy.yml, environment: sit } }
  - { key: sit-testing, type: work, assigneeRole: qa-lead, output: sit-report }
  - { key: sit-signoff, type: gate, approverRole: qa-lead, slaHours: 48 }
  - { key: deploy-uat, type: action, action: { workflow: deploy.yml, environment: uat } }
  - { key: uat-testing, type: work, assigneeRole: business-owner, output: uat-report }
  - { key: uat-signoff, type: gate, approverRole: business-owner, slaHours: 72 }
  - {
      key: deploy-preprod,
      type: action,
      action: { workflow: deploy.yml, environment: preprod },
      condition: initiative.flags.requiresPreprod,
    }
  - {
      key: preprod-checks,
      type: work,
      assigneeRole: release-manager,
      output: preprod-report,
      condition: initiative.flags.requiresPreprod,
    }
  - {
      key: preprod-signoff,
      type: gate,
      approverRole: release-manager,
      slaHours: 48,
      condition: initiative.flags.requiresPreprod,
    }
reworkTargets: [build, work-breakdown]
```

```yaml
# config/stages/01-brief.yaml — the only stage enabled in the MVP
key: brief
name: Brief
order: 1
enabled: true
requiredInputs:
  - { type: business-request }
  - { type: stakeholder-notes }
outputs: [feature-hypothesis, user-journeys, nfrs, epics]
agent: product-brief-agent
steps:
  - { key: draft-brief, type: work, agentDrafts: true, assigneeRole: contributor }
  - { key: epic-approval, type: gate, approverRole: product-owner, slaHours: 48 }
reworkTargets: []
```

## 5. Transition rules

| Event                                           | Effect                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Required inputs approved upstream               | StageRun created; first step starts (drafting stages start an AgentRun)                                       |
| Agent raises a blocking question                | StageRun → _needs input_; owner notified in MS Teams; resumes on answer                                       |
| Action step starts                              | IntegrationJob triggers the GitHub Actions workflow; StepRun → _running_ until the webhook reports the result |
| Action step fails                               | Retried once; then StepRun → _failed_, owner notified, stage pauses until retried or sent back                |
| Work step completes                             | Its output is saved as a version and added to the package for the next gate                                   |
| Gate approved                                   | Next step starts; after the last step, StageRun → _approved_                                                  |
| Changes requested at a gate                     | Steps restart from the first on resubmission (for Test: redeploy to SIT)                                      |
| Test failure, or rejection with a rework target | Initiative returns to the target stage as a new attempt; later StageRuns _superseded_                         |
| Rejected without a target                       | Initiative → _cancelled_                                                                                      |
| Conditional step whose condition is false       | StepRun recorded as _skipped_                                                                                 |
| StageRun approved                               | IntegrationJobs enqueued; next StageRun created with the approved package as input                            |
| New version of an approved upstream artifact    | Downstream StageRuns that used it flagged _upstream changed_ and blocked until re-reviewed                    |
| Gate SLA at 50% / 100%                          | Reminder to assignee / escalation to backup approver                                                          |

Durable execution: Temporal is the proposed engine (decisions as signals,
agent runs and integration writes as activities, SLA reminders as timers).
Hosting is an open question (Temporal Cloud, self-hosted on ECS, or AWS Step
Functions). Keep sequencing rules pure in `src/workflow` so they don't depend
on the engine.

## 6. Domain model

**Configuration (in the repo):** StageDefinition, StepDefinition,
TemplateDefinition (artifact type, version, JSON Schema, rubric).

**Runtime records (PostgreSQL on RDS; large content in S3):**

| Entity          | Key fields                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initiative      | id, key, title, requesterId, ownerId, status (active, on_hold, done, cancelled), currentStageKey, flags                                                       |
| StageRun        | id, initiativeId, stageKey, attempt, state, configVersion, startedAt, completedAt                                                                             |
| Artifact        | id, stageRunId, type, title                                                                                                                                   |
| ArtifactVersion | id, artifactId, number, contentKey (S3), contentHash, format, createdByType (agent, user), createdById, sourceVersionIds                                      |
| ReviewPackage   | id, stageRunId, versionIds, packageHash, submittedBy, submittedAt, status                                                                                     |
| StepRun         | id, stageRunId, stepKey, type, packageId, state (pending, running, waiting, done, failed, skipped), externalRunId                                             |
| GateRun         | id, stepRunId, packageId, state, assigneeId, dueAt                                                                                                            |
| Decision        | id, gateRunId, packageHash, reviewerId, outcome (approve, request_changes, reject), reworkTarget, feedback, decidedAt                                         |
| OpenQuestion    | id, versionId, text, blocking, status, answer, answeredById                                                                                                   |
| Comment         | id, versionId, anchor, authorId, body, resolved                                                                                                               |
| AgentRun        | id, stageRunId, agentKey, agentVersion, provider, model, templateVersion, inputVersionIds, outputVersionIds, status, tokensIn, tokensOut, costUsd, durationMs |
| IntegrationJob  | id, decisionId or stepRunId, adapter, action, payloadKey, idempotencyKey, status, attempts, lastError                                                         |
| ExternalLink    | id, entityType, entityId, system, externalId, url                                                                                                             |
| AuditEvent      | id, occurredAt, actorType, actorId, action, entityType, entityId, initiativeId, data, prevHash, hash                                                          |
| RoleAssignment  | userId, role, scope (global, team, initiative)                                                                                                                |

Package hash: SHA-256 over the sorted version content hashes, so order doesn't
matter. Content hashes normalise line endings first.

## 7. Vendor-neutral AI layer

Three contracts, written as JSDoc typedefs in `src/ai`. Only
`src/ai-adapters/<vendor>/` imports vendor SDKs.

**ModelProvider**

- `id: string` — e.g. `anthropic`, `bedrock`, `stub`
- `complete(request) → Promise<CompletionResult>`
- `capabilities(model) → { toolUse, structuredOutput, maxContextTokens }`

**CompletionRequest:** `model` (from routing config), `system`, `messages`,
optional `tools` (JSON Schema), optional `outputSchema` (structured output),
`maxTokens`, `metadata { initiativeId, stageKey, agentRunId }`.

**CompletionResult:** `content` blocks (`text` | `tool_call` | `json`),
`stopReason` (`end` | `tool_call` | `max_tokens` | `error`),
`usage { inputTokens, outputTokens, costUsd }`, `provider`, `model`.

**CodingAgent** (from the Build slice; Claude Code first, run in GitHub Actions)

- `id: string`
- `run(task) → Promise<CodingResult>`; task = repo, baseBranch, workBranch,
  instructions, allowedCommands, timeoutMinutes; result = commits, testSummary,
  status (`success` | `tests_failed` | `blocked` | `error`), questions, usage.

**StageAgent**

- `key`, `version`
- `draft(context) → Promise<DraftResult>` — artifacts + open questions + usage
- `selfCheck(draft, context) → Promise<RubricCheck[]>`

**Routing** (`config/routing.yaml`): provider and model per stage, a default,
and a fallback. Switching vendor for a stage = config change + passing
golden-set evals. Model IDs come from the environment.

**Agent run loop:** build context from approved inputs → `draft` → tool calls
executed by the runtime under the stage's allow-list (read-only tools only) →
`selfCheck` against the rubric → store versions, open questions and the
AgentRun record.

## 8. Integration pattern

- Transactional outbox: the approval and its IntegrationJobs commit together;
  a worker runs each job through an adapter (`read`, `write`, `verify`).
- Idempotency key: `decisionId + action + artifactId`; adapters check for an
  existing ExternalLink before creating.
- Retries: exponential backoff up to 5 attempts, then _failed_ + MS Teams alert;
  handoff still proceeds and the job can be retried.
- Nightly reconciliation calls `verify` and flags drift.
- One service identity per adapter, least privilege, credentials from Secrets
  Manager via the environment.
- Inbound GitHub / GitHub Actions webhooks are signature-verified and become
  workflow signals.
- **MVP adapters:** MS Teams notifications only.

## 9. Roles

| Role                     | Can                                                 |
| ------------------------ | --------------------------------------------------- |
| Requester                | Create Initiatives; edit own Brief drafts           |
| Contributor              | Edit drafts and submit packages for assigned stages |
| Approver (per gate role) | Comment; decide matching gates                      |
| Backup approver          | Decide when assigned or escalated                   |
| Platform admin           | Change stage config and routing (via reviewed PRs)  |
| Auditor                  | Read everything                                     |
| Agent (service identity) | Create versions only; never decide                  |

Roles come from IdP groups (SSO). Authors of a package can't decide its gates.

## 10. API (MVP)

REST behind SSO; state-changing calls signal the workflow.

| Method and path                                                                      | Purpose                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `POST /initiatives`                                                                  | Create an Initiative                             |
| `GET /initiatives/{id}`                                                              | Initiative with stage runs, current step, links  |
| `GET /initiatives/{id}/timeline`                                                     | Audit trail                                      |
| `POST /stage-runs/{id}/agent-runs`                                                   | Start or re-run the stage agent                  |
| `GET /artifacts/{id}/versions` · `GET /versions/{id}` · `GET /versions/{a}/diff/{b}` | Versions, content, diffs                         |
| `POST /artifacts/{id}/versions`                                                      | Save a human edit as a new version               |
| `POST /stage-runs/{id}/packages`                                                     | Submit a review package                          |
| `POST /gate-runs/{id}/decisions`                                                     | Decide, with the package hash (409 on mismatch)  |
| `POST /open-questions/{id}/answer` · `POST /versions/{id}/comments`                  | Answer questions; comment                        |
| `GET /me/inbox`                                                                      | Gates and questions waiting for the current user |
| `GET /health`                                                                        | Health check                                     |

NFR targets (MVP): 99.5% in business hours; views under 2 s p95; Brief draft
under 5 minutes; SSO only; encryption in transit and at rest; 10–20 active
Initiatives and 30 users, designed for a few hundred Initiatives; cost per
AgentRun by provider.

## 11. Proposed stack

| Layer            | Choice                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| Runtime          | Node.js, JavaScript (ESM) + JSDoc, checked by `tsc`                                   |
| API              | Fastify (to confirm; the original doc proposed NestJS, which suits TypeScript better) |
| Validation       | Zod                                                                                   |
| Workflow engine  | Temporal (hosting to confirm)                                                         |
| Database         | Amazon RDS for PostgreSQL                                                             |
| Artifact storage | Amazon S3                                                                             |
| Frontend         | React (framework to confirm in the web-app phase)                                     |
| Hosting          | ECS Fargate, Secrets Manager, IAM role per service/agent                              |
| IaC              | AWS CDK (JavaScript)                                                                  |
| CI/CD            | GitHub Actions with OIDC to AWS; SonarQube                                            |
| Notifications    | MS Teams                                                                              |
| Observability    | CloudWatch + OpenTelemetry                                                            |

## 12. MVP scope and acceptance

**In:** core engine (Initiatives, StageRuns, versions, packages, step
sequences exercised with one gate, rework and upstream-changed logic tested);
AI layer with Claude adapter, routing and AgentRun cost recording; basic Brief
agent; web app (create, view/edit as new versions, diff, questions, inbox,
decisions); SSO and roles; audit log and timeline; MS Teams alerts; platform
dev and prod on AWS.

**Out:** Jira/Confluence writes, Figma and GitHub adapters, CodingAgent, stages
02–07, SLA escalation, retry UI, PDF export, a second model provider.

**Acceptance:**

- 5 real past requests run end to end: create → draft → edit → approve.
- Editing an approved version creates a new version and reopens review.
- A decision with a stale package hash is refused.
- A package author cannot approve it.
- Every action appears in the timeline, and the hash chain verifies.
- Each AgentRun shows provider, model, template version and cost.
- Swapping the Claude adapter for a stub provider needs only a config change.
- The product owner rates at least 3 of 5 drafts as a useful starting point.

## 13. Open questions

- Security sign-off: Claude via the Anthropic API, or only via Amazon Bedrock?
- SSO: which IdP, and which groups map to which roles?
- MVP trial approver and the 5 past requests.
- Workflow engine hosting.
- Record-retention period for approvals and audit events.
- Existing brief / epic template for the Brief agent.
- SonarQube: self-hosted SonarQube or SonarCloud; project key.
