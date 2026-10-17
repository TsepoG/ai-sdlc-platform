# Phase roadmap

Each phase gets its own detailed file (`docs/phases/NN-name.md`) written at
the start of that phase, so it can use what earlier phases taught. Only
Phase 00 is detailed now. One branch and one PR per phase (or smaller).

## Groundwork and MVP (weeks 1–9)

| Phase | Weeks | Scope | Done when |
| --- | --- | --- | --- |
| 00 Foundation | 1–2 | Tooling, config/errors/logger, Fastify `/health`, Docker, CDK (registry, ECS, OIDC), CI + deploy workflows | Hello-world deployed to platform dev; `verify` green |
| 01 Core rules | 3 | `config/stages/*.yaml` for all 7 stages (only Brief enabled) + Zod validation; pure step sequencing (`nextMove`, conditions, rework, restart); content and package hashing; separation of duties; `src/ai` contracts as JSDoc typedefs; routing config; stub provider | Rule tests cover approve, changes, reject, stale hash, skipped conditional steps, Test-stage deploy → test → sign-off order |
| 02 Persistence and workflow | 3–4 | RDS schema and migrations, S3 content store, immutable versions, review packages, audit log with hash chain, Temporal workflows driving the pure rules | API creates an Initiative and walks a Brief through draft → approve against a real database |
| 03 AI layer and Brief agent | 5 | Claude adapter in `src/ai-adapters/anthropic`, agent run loop with read-only tool allow-list, Brief template and rubric, AgentRun cost recording | Agent drafts a Brief with open questions from a sample request; stub swap is config-only |
| 04 SSO and web app | 6 | SSO + roles from IdP groups; inbox, version view and diff, edit as new version, questions, decisions | Full loop works in the browser |
| 05 Timeline, Teams, hardening | 7 | Audit timeline UI, MS Teams notifications, end-to-end tests, platform prod deploy | All MVP acceptance criteria automated and green in dev |
| — MVP trial | 8–9 | Product owner runs 5 real requests; fixes | MVP signed off |

## Stage slices (from January)

01 Brief (full) → 02 UX design → 03 Tech design + TDF → 04 Work breakdown →
05 Build → 06 Deploy → 07 Test → hardening. Each slice: detailed stage design →
agent, template and integrations → real use by the pilot team → refine. See
`docs/design/core-design.md`.
