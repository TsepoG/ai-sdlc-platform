# CLAUDE.md

Context for Claude Code in this repository. Read this first, then
`CODING_PRINCIPLES.md`, then the current phase file.

## What we're building

An internal **AI-assisted SDLC platform**. For each Initiative (a feature or
change request), a stage-specific AI agent drafts the artifacts for that
stage, and a named human approves the exact version before work moves on.

Seven stages: **Brief → UX design → Tech design → Work breakdown → Build →
Deploy → Test**. The Test stage runs deploy → test → sign-off for SIT, then
UAT, then preprod when required. Production deployment is out of scope.

Existing tools stay the systems of record: **Jira, Confluence, Figma, GitHub**.
The platform runs on **AWS**, uses **GitHub Actions** for CI/CD and **MS Teams**
for notifications. The AI layer is **vendor-neutral**: Claude and Claude Code
are the first adapters, and other vendors must be pluggable without changing
the workflow.

## Where things are

| Need                                         | Read                             |
| -------------------------------------------- | -------------------------------- |
| How to write code here                       | `CODING_PRINCIPLES.md` (binding) |
| Architecture, domain model, rules, MVP scope | `docs/design/core-design.md`     |
| What to build now                            | `docs/phases/<current phase>.md` |
| Order of phases                              | `docs/phases/ROADMAP.md`         |
| Decisions already made                       | `docs/decisions/`                |

Precedence when documents disagree: **owner's instruction in chat >
CODING_PRINCIPLES.md > phase file > core-design.md**. On any real conflict,
stop and ask rather than choosing.

## Current state

- **Phase:** 00 — Repository foundation (`docs/phases/00-foundation.md`).
- **MVP target:** core platform + basic Brief agent, signed off by week 9.
- Nothing is deployed yet. AWS accounts, GitHub environments, SSO and
  SonarQube credentials are being set up by the owner.

## Non-negotiables (summary — details in CODING_PRINCIPLES.md §10)

1. **Stages are configuration** (`config/stages/*.yaml`); the engine never
   branches on a stage key.
2. **Approval binds to a content hash**; stale decisions are refused.
3. **Versions are immutable** once submitted.
4. **Agents draft, people decide** — no agent approves, merges, deploys or
   writes to a system of record.
5. **AI vendor SDKs only in `src/ai-adapters/<vendor>/`**; everything else uses
   `src/ai` contracts. Lint-enforced.
6. **Downstream writes only from approved versions**, via the outbox.
7. **Everything auditable**, append-only and hash-chained.
8. Call the company frontend application the **"frontend app" / "frontend
   repo"** — no internal abbreviations.

## How to work

- **Never commit, push, merge, rebase, reset or tag.** Stop at each natural
  stopping point, summarise the change, and propose a Conventional Commit
  message (no AI attribution).
- Start each phase on a new branch from the latest `origin/main`
  (`git fetch origin`, then `git switch -c <branch> origin/main`).
- When the phase is done and the owner has pushed the branch, open the PR with
  `gh pr create --base main` using the phase's PR description. Never merge it.
- Plan first: list the files you'll create or change and the tests you'll
  write. Wait for the owner's go-ahead on the plan at the start of a phase.
- Implement in small steps; run `npm run verify` after each meaningful step.
- Read official docs or type definitions before using an unfamiliar API
  (Fastify, AWS CDK, Zod, Vitest, GitHub Actions, Anthropic SDK). Don't invent
  options.
- If something is ambiguous or blocked (missing credentials, an open question
  below), stop and report it. Don't guess and don't work around it.
- Keep `README.md` and `.env.example` in step with the code.
- Never put real company data into tests, fixtures or model calls. Use
  synthetic data until security signs off the model provider route.

## Commands (once Phase 00 lands)

```bash
npm ci
npm run verify        # format check, lint, typecheck, tests with coverage
npm run audit         # npm audit --audit-level=high
npm test              # tests only
cd infra && npx cdk synth
```

## Layout (target)

```
src/
  config/        env loading + validation (only place reading process.env)
  errors/        AppError subclasses
  logger/        structured JSON logger
  server/        Fastify app + routes
  stages/        stage config loading + validation        (phase 01)
  workflow/      pure sequencing, hashing, duties rules     (phase 01)
  ai/            ModelProvider / CodingAgent / StageAgent contracts, routing, stub (phase 01)
  ai-adapters/   vendor adapters, e.g. anthropic/ — the only vendor SDK imports (phase 03)
test/            mirrors src/
config/
  stages/        01-brief.yaml … 07-test.yaml
  routing.yaml   provider + model per stage
  templates/     versioned prompt templates and rubrics
infra/           AWS CDK (JavaScript)
docs/
  design/  phases/  decisions/
```

## Open questions (don't resolve these yourself)

- Model provider route: Anthropic API directly, or Claude via Amazon Bedrock.
- IdP for SSO and the group-to-role mapping.
- Workflow engine hosting: Temporal Cloud, self-hosted Temporal, or Step Functions.
- API framework confirmation (Fastify proposed).
- SonarQube vs SonarCloud, and the project key.
- AWS region for the platform.
