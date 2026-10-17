# Phase 00 — Repository foundation

**Goal:** a repo where every later phase can start writing features straight
away, and a pipeline that ships a hello-world API to the platform's AWS dev
environment.

**Branch:** `chore/phase-00-foundation` · **Size:** about 1 week of the
2-week groundwork. The other week is people work (security sign-off, SSO,
trial approver) that does not involve code.

## In scope

### 1. Tooling

- `package.json` (`"type": "module"`, `engines` per `CODING_PRINCIPLES.md`),
  `.nvmrc` (24), `package-lock.json`.
- npm scripts: `lint`, `format`, `format:check`, `typecheck`, `test`,
  `test:coverage`, `test:live` (empty set for now), `verify`
  (`format:check` + `lint` + `typecheck` + `test:coverage`), `audit`
  (`npm audit --audit-level=high`).
- `jsconfig.json` or `tsconfig.json` with `checkJs`, `strict`, `noEmit`.
- ESLint flat config (`eslint.config.js`) with the plugins listed in section 7
  of the principles, `--max-warnings=0`, `no-console` in `src/`, and:
  - a rule (or `no-restricted-properties` / `no-restricted-syntax`) that blocks
    `process.env` outside `src/config/`;
  - `no-restricted-imports` blocking AI vendor SDKs (`@anthropic-ai/*`,
    `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`, `@mistralai/*`,
    `cohere-ai`) everywhere except `src/ai-adapters/**`.
- Prettier config; `.editorconfig`.
- `vitest.config.js` with coverage thresholds at 90% for lines, branches,
  functions and statements; only entry-point wiring files excluded, each with a
  comment.
- `.claude/settings.json` with `"attribution": { "commit": "", "pr": "" }` and
  permission rules denying `git commit`, `git push`, `git merge`,
  `git rebase`, `git reset` and `git tag`.
- `.gitignore`, `.env.example`.

### 2. Shared foundations (`src/`)

- `src/config` — loads and validates environment with Zod; the only place that
  reads `process.env`. Variables for now: `NODE_ENV`, `PORT`, `LOG_LEVEL`,
  `APP_VERSION`, `PLATFORM_ENV`.
- `src/errors` — base `AppError` and `ConfigError` (with `cause`).
- `src/logger` — structured JSON logger with level and request ID (pino is
  fine if it fits the principles; otherwise a thin wrapper).
- `src/server` — Fastify app factory (`buildServer({ config, logger })`) with
  `GET /health` returning `{ status: "ok", version }`, request IDs, and an
  error handler that maps `AppError`s; a `main.js` entry point that wires real
  config and starts listening.

### 3. Tests (`test/`)

- Config: valid env passes; missing or invalid values throw `ConfigError`.
- Server: `/health` responds 200 with the version; unknown route is 404; an
  `AppError` is mapped to the right status without leaking internals.
- Logger: emits JSON with level and request ID.
- Lint boundary: using ESLint's Node API, prove that importing
  `@anthropic-ai/sdk` from `src/workflow/x.js` is an error and from
  `src/ai-adapters/anthropic/x.js` is not; prove `process.env` outside
  `src/config` is an error.

### 4. Container

- Multi-stage `Dockerfile` (Node 24 slim, `npm ci --omit=dev` in the runtime
  stage, non-root user, `PORT=8080`), `.dockerignore`.

### 5. Infrastructure (`infra/`, AWS CDK in JavaScript)

- `RegistryStack` — ECR repository per platform environment (scan on push,
  lifecycle rule). Separate so the image can be pushed before the service
  exists.
- `PlatformStack` — VPC (2 AZs), ECS cluster, Fargate service behind an ALB
  with `/health` health check, log group, a Secrets Manager secret placeholder
  for the model API key (value set manually later), circuit-breaker rollback.
- `GithubOidcStack` — GitHub OIDC provider and a deploy role restricted to this
  repo's `main` branch and its GitHub environments.
- Region and account come from the environment; CDK synth must work in CI
  without AWS credentials (environment-agnostic synth).

### 6. GitHub Actions

- `ci.yml` on PRs and pushes to `main`: install, `npm run verify`,
  `npm run audit`, CDK synth, SonarQube scan (uses `SONAR_TOKEN` and
  `SONAR_HOST_URL` secrets; skip with a clear notice if they are not set yet).
- `deploy-platform.yml`: after CI succeeds on `main` → deploy to `platform-dev`;
  manual dispatch for `platform-prod` (protected environment). Steps: OIDC auth
  → deploy RegistryStack → build and push image tagged with the commit SHA →
  deploy PlatformStack → smoke test `GET /health` on the ALB URL.

### 7. Docs

- `README.md`: what the platform is, prerequisites, setup, scripts, first AWS
  deployment steps (CDK bootstrap, OIDC stack, GitHub environments and
  variables `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`), and the warning that the ALB
  must go behind SSO or become internal before real data is used.
- `docs/decisions/0001-javascript-jsdoc.md` and
  `docs/decisions/0002-fastify.md` (short ADRs; mark 0002 as _proposed_ until
  the owner confirms).

## Out of scope (later phases)

Stage configuration, workflow rules, AI contracts and adapters, database,
Temporal, SSO, web app, Jira/Confluence/Figma/Teams adapters.

## Acceptance criteria

- [ ] `npm run verify` passes locally with coverage ≥ 90% on all four measures.
- [ ] `npm run audit` passes.
- [ ] The vendor-SDK and `process.env` lint boundaries are proven by tests.
- [ ] `npx cdk synth` (from `infra/`) succeeds without AWS credentials.
- [ ] `docker build .` succeeds and the container answers `GET /health`.
- [ ] CI workflow is valid (run `actionlint` if available) and runs verify,
      audit, synth and the SonarQube step.
- [ ] Deploy workflow is written; first real deploy is done by the owner once
      AWS and GitHub environments exist (Claude Code cannot do this).
- [ ] README and `.env.example` match the code.
- [ ] No commits made by Claude Code; a Conventional Commit message is proposed
      for each stopping point.
- [ ] After the owner pushes the branch, a PR into `main` is opened with
      `gh pr create`, describing what changed, how it was tested, and which
      acceptance criteria it meets.

## Inputs the owner provides

- AWS account and region for the platform; CDK bootstrap.
- GitHub environments `platform-dev`, `platform-prod` and their variables.
- SonarQube host URL, token and project key.
