# ai-sdlc-platform

An internal **AI-assisted SDLC platform**. For each Initiative (a feature or change request), a stage-specific AI agent drafts the artifacts for that stage, and a named human approves the exact version before work moves on.

Seven stages: **Brief → UX design → Tech design → Work breakdown → Build → Deploy → Test**. Jira, Confluence, Figma and GitHub stay the systems of record. The platform runs on AWS and the AI layer is vendor-neutral.

**Status:** Phase 02 (persistence and workflow). On top of the foundation (Phase 00) and the core rules (Phase 01: stages as configuration, `nextMove`, hashing, decision rights, AI contracts), an Initiative can now be created and walked through the Brief stage against PostgreSQL: immutable versions, hash-bound decisions, an insert-only hash-chained audit trail, an outbox job worker, and an S3 (or local) content store. The workflow API runs locally only until SSO arrives (Phase 04). See [docs/phases/ROADMAP.md](docs/phases/ROADMAP.md).

## Documents

| Need                                  | Read                                                     |
| ------------------------------------- | -------------------------------------------------------- |
| How to write code here (binding)      | [CODING_PRINCIPLES.md](CODING_PRINCIPLES.md)             |
| Context for Claude Code               | [CLAUDE.md](CLAUDE.md)                                   |
| Architecture, domain model, MVP scope | [docs/design/core-design.md](docs/design/core-design.md) |
| What to build now                     | [docs/phases/](docs/phases/)                             |
| Decisions already made                | [docs/decisions/](docs/decisions/)                       |

## Prerequisites

- Node.js `^22.22.2 || >=24.15.0` (`.nvmrc` pins 24; use `nvm use` or similar).
- Docker, to build and run the container and to run PostgreSQL locally (`docker compose`).
- For the first deployment only: an AWS account, the AWS CLI, and permission to bootstrap CDK.

## Setup

```bash
npm ci
docker compose up -d     # PostgreSQL 17 on localhost:5432 (matches .env.example)
cp .env.example .env     # then adjust; .env is git-ignored
npm start                # loads .env; applies pending migrations, then listens on PORT
curl localhost:8080/health
```

The service applies pending database migrations at startup, before it listens, and refuses to start if they fail.

- `GET /health` (liveness) returns `{ "status": "ok", "version": "<APP_VERSION>" }`.
- `GET /ready` returns `{ "status": "ready" }`, or 503 `{ "status": "not_ready" }` when the database doesn't answer.
- `GET /stages` returns the loaded stage configuration: `{ "stages": [{ "key", "name", "order", "enabled", "steps": [{ "key", "type", "condition" }] }] }`.

To run the tests, the suite needs a PostgreSQL it can create schemas in (each test file gets its own and drops it afterwards):

```bash
export TEST_DATABASE_URL=postgres://platform:change-me-local-only@localhost:5432/platform
npm run verify
```

## Configuration

`src/config` is the only code that reads the environment, and it validates everything with Zod at startup. Missing or invalid values stop the process with a `ConfigError` that names the variable (never its value). `.env.example` lists every variable.

| Variable                                                                                      | Values                                           | Default                       | Notes                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`                                                                                    | `development`, `test`, `production`              | none                          | required                                                           |
| `PORT`                                                                                        | 1-65535                                          | `8080`                        |                                                                    |
| `LOG_LEVEL`                                                                                   | `fatal` … `trace`, `silent`                      | `info`                        |                                                                    |
| `APP_VERSION`                                                                                 | any non-empty string                             | none                          | reported by `/health`; CI sets the commit SHA                      |
| `PLATFORM_ENV`                                                                                | `local`, `test`, `platform-dev`, `platform-prod` | none                          | required                                                           |
| `STAGES_DIR`                                                                                  | a directory path                                 | `config/stages`               | relative to the working directory; read at startup                 |
| `DATABASE_HOST`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`                        | strings                                          | none                          | required; in AWS, ECS fills them from the database secret's fields |
| `DATABASE_PORT`                                                                               | 1-65535                                          | `5432`                        |                                                                    |
| `DATABASE_SSL`                                                                                | `true`, `false`                                  | `true`                        | when `true` the server certificate is always verified              |
| `DATABASE_POOL_MAX`                                                                           | positive integer                                 | `10`                          |                                                                    |
| `CONTENT_STORE`                                                                               | `local`, `s3`                                    | `local`                       |                                                                    |
| `CONTENT_DIR`                                                                                 | a directory path                                 | `data/content`                | local store only                                                   |
| `CONTENT_BUCKET`                                                                              | bucket name                                      | none                          | required when `CONTENT_STORE=s3`                                   |
| `WORKFLOW_API_ENABLED`                                                                        | `true`, `false`                                  | `false`                       | `true` only when `PLATFORM_ENV` is `local` or `test`               |
| `AUTH_MODE`                                                                                   | `none`, `dev-headers`                            | `none`                        | `dev-headers` only when `PLATFORM_ENV` is `local` or `test`        |
| `WORKER_ENABLED`                                                                              | `true`, `false`                                  | `true`                        | runs the job worker in this process                                |
| `WORKER_POLL_INTERVAL_MS`, `WORKER_BACKOFF_BASE_MS`, `WORKER_MAX_ATTEMPTS`, `WORKER_LEASE_MS` | positive integers                                | `1000`, `5000`, `5`, `300000` | retry delay doubles per attempt                                    |

## Stage configuration

Each stage is one YAML file in `config/stages/`, named `NN-<key>.yaml` (`01-brief.yaml` … `07-test.yaml`). A file sets the stage's `key`, `name`, `order`, `enabled`, `requiredInputs`, `outputs`, `agent`, ordered `steps` and `reworkTargets`. Only `brief` is enabled in the MVP. The engine in `src/workflow` never branches on a stage key, so changing a stage means editing its file (and later its templates and agent), not the engine. Why YAML in the repo: [ADR 0003](docs/decisions/0003-stage-config-as-yaml.md).

Steps are one of three types, and unknown keys are rejected:

| Type     | Fields                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `work`   | `key`, optional `assigneeRole`, `agentDrafts`, `output` (must be one of the stage's `outputs`), `condition` |
| `action` | `key`, `action: { workflow: <file>.yml, environment: <slug> }`, optional `condition`                        |
| `gate`   | `key`, `approverRole`, optional `slaHours` (positive integer), `condition`                                  |

`condition` makes a step optional. The only form is `initiative.flags.<name>` (for example `initiative.flags.requiresPreprod`); the step runs only when that flag is `true`. Anything else is rejected when the file loads.

**Validation rules.** Per file: keys are lowercase slugs; step keys are unique; `order` is a positive integer; `outputs` is not empty; there is at least one gate; the last step is a gate, and so is the last unconditional step, so a stage always ends in an approval. Across files: `order` and `key` are unique; every `requiredInputs[].fromStage` is an earlier stage that lists that input's `type` in its `outputs`; every `reworkTargets` entry is an earlier stage. Errors name the file and the path, and list every problem at once.

**Transitions.** `nextMove` in `src/workflow` decides where a stage goes after a step outcome. `done` moves to the next planned step, or approves the stage after the last. `changes_requested` at a gate restarts at the first planned step. `rejected` at a gate cancels the Initiative, or reworks to a stage in `reworkTargets` when a target is given. A failed action pauses. A failed agent-drafted work step pauses. Any other failed work step (people or tests) reworks to the first `reworkTargets` entry, or pauses if there is none. Every other combination throws `InvalidTransitionError`.

**Checking a change.** The server loads and validates the stages at startup and refuses to start on invalid configuration, and `npm test` loads the real files (`test/stages/real-config.test.js`). Run `npm run verify` before opening a PR. AI routing lives alongside in `config/routing.yaml` (every stage on the offline `stub` provider until Phase 03).

## Database and workflow

Workflow state lives in PostgreSQL; there is no separate workflow engine ([ADR 0004](docs/decisions/0004-workflow-state-in-postgresql.md)). Each service call (`src/initiatives`) loads state, asks the Phase 01 rules what happens and writes the result with its audit events in one transaction.

- **Migrations** are numbered SQL files in `migrations/` (`0001_*.sql` …), applied at startup by `src/db` under a PostgreSQL advisory lock, so two tasks starting together can't both apply one. Applied migrations are recorded with a checksum; changing one afterwards stops the service. Never edit an applied migration; add a new one.
- **Enforced by the database:** `artifact_versions`, `decisions`, `audit_events` and `review_package_versions` are insert-only (triggers reject UPDATE, DELETE and TRUNCATE). CHECK constraints cover every state and outcome column. Unique constraints make retries safe: one open package per stage run, one open gate per step, one decision per gate, unique version numbers and job idempotency keys.
- **Audit trail:** every change appends an event with `hash = sha256(prevHash + canonical JSON of the event)`, in the same transaction. `verifyAuditChain()` in `src/audit` recomputes the chain and reports the first break.
- **Content store** (`src/content`): version content is stored under content-addressed keys (`sha256/<hash>`), on the local filesystem or in S3 (`CONTENT_STORE`). Storing the same content twice is a no-op, and reads are checked against the key.
- **Job worker** (`src/jobs`): the `jobs` table is the outbox. Jobs are enqueued in the transaction that causes them (an approval queues one), claimed with `FOR UPDATE SKIP LOCKED`, retried with exponential backoff and marked failed after `WORKER_MAX_ATTEMPTS`. Phase 02 has one handler, `log`.

### Workflow API (local and test only)

The dev load balancer is public HTTP with no SSO yet, so the workflow routes register only when `WORKFLOW_API_ENABLED=true`. Config refuses that unless `PLATFORM_ENV` is `local` or `test` **and** `NODE_ENV` is not `production`. The image always runs with `NODE_ENV=production`, so the workflow API runs only via `npm start`, never in the container. In deployed environments config also refuses `DATABASE_SSL=false`. Text fields reject NUL characters and unpaired surrogates with a 400. Identity is a dev-only header pair, `x-dev-user-id` and `x-dev-user-roles` (comma-separated), accepted only with `AUTH_MODE=dev-headers` under the same condition. Phase 04 replaces it with SSO.

| Route                                                    | Purpose                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /initiatives`                                      | Create an Initiative (`title`, `request`, optional `notes`, `flags`)                                                                      |
| `GET /initiatives/:id` · `GET /initiatives/:id/timeline` | Initiative with stage runs; its audit trail                                                                                               |
| `POST /artifacts/:id/versions` · `GET /versions/:id`     | Save a new version; read one with its content                                                                                             |
| `POST /stage-runs/:id/packages`                          | Submit versions for review (`versionIds`)                                                                                                 |
| `POST /gate-runs/:id/decisions`                          | Decide (`outcome`, `packageHash`, optional `reworkTarget`, `feedback`); 409 on a stale hash, 403 for the package author or a missing role |
| `POST /open-questions/:id/answer`                        | Answer an open question                                                                                                                   |

```bash
curl -s -X POST localhost:8080/initiatives -H 'content-type: application/json' \
  -H 'x-dev-user-id: u-author' -d '{"title":"Synthetic","request":"A synthetic request."}'
```

### RDS CA bundle

RDS requires TLS, and the service verifies the server certificate (`rejectUnauthorized` stays on). The image ships `certs/rds-global-bundle.pem`, the public RDS CA bundle, and sets `NODE_EXTRA_CA_CERTS` to it. To refresh it (for example when AWS rotates CAs), download `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`, replace `certs/rds-global-bundle.pem`, check it parses (`openssl crl2pkcs7 -nocrl -certfile certs/rds-global-bundle.pem | openssl pkcs7 -print_certs -noout | grep -c subject=`) and open a PR.

## Scripts

| Script                  | What it does                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `npm run verify`        | `format:check`, `lint`, `typecheck`, `test:coverage` (run this before every commit) |
| `npm run lint`          | ESLint, zero warnings allowed                                                       |
| `npm run format`        | Prettier, write                                                                     |
| `npm run format:check`  | Prettier, check only                                                                |
| `npm run typecheck`     | `tsc --noEmit` over the JSDoc types (`checkJs`, `strict`)                           |
| `npm test`              | Vitest, excluding tests tagged `live` (needs `TEST_DATABASE_URL`)                   |
| `npm run test:coverage` | Vitest with coverage; fails below 90% for lines, branches, functions, statements    |
| `npm run test:live`     | Only tests tagged `live` (none yet)                                                 |
| `npm run audit`         | `npm audit --audit-level=high`                                                      |
| `npm start`             | Run the API locally                                                                 |

CDK commands run from `infra/`: `cd infra && npx cdk synth`. Synth needs no AWS credentials.

## Layout

```
src/
  config/    environment loading and validation (only place reading process.env)
  errors/    AppError and its subclasses
  logger/    structured JSON logger (pino)
  server/    Fastify app factory, /health, /ready, /stages, workflow routes, main.js entry point
  stages/    stage configuration loading and validation
  workflow/  pure rules: conditions, planned steps, nextMove, hashing, decision rights
  ai/        vendor-neutral contracts, routing, stub provider (no vendor SDKs)
  db/        pg pool, transactions, migration runner
  content/   content-addressed store (local filesystem or S3)
  audit/     hash-chained audit events and chain verification
  initiatives/  workflow services: create, versions, packages, decisions, questions
  jobs/      outbox job worker
config/
  stages/    01-brief.yaml … 07-test.yaml
  routing.yaml  provider and model per stage
migrations/  numbered SQL migrations, applied at startup
certs/       RDS CA bundle shipped in the image
test/        mirrors src/, plus test/infra, test/lint (lint-boundary tests) and the provider contract suite
infra/       AWS CDK (JavaScript): registry, platform (with RDS and S3) and GitHub OIDC stacks
.github/     ci.yml and deploy-platform.yml
docs/        design, phases, decisions
```

Each `src/` folder exposes only its `index.js`; import from there, not from internal files.

## Enforced boundaries

ESLint enforces two rules from the coding principles, and tests prove they fire (`test/lint/boundaries.test.js`):

- AI vendor SDKs (`@anthropic-ai/*`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock*`, `@mistralai/*`, `cohere-ai`) can only be imported under `src/ai-adapters/<vendor>/`.
- `process.env` (including `import { env } from 'node:process'`) can only be used in `src/config/`.

`test/ai/vendor-neutral.test.js` also checks that `src/ai` imports no vendor SDK and never names a vendor.

## Container

```bash
docker compose up -d
docker build --build-arg APP_VERSION=local -t ai-sdlc-platform .
docker run --rm --network host -e PLATFORM_ENV=local \
  -e DATABASE_HOST=127.0.0.1 -e DATABASE_NAME=platform -e DATABASE_USER=platform \
  -e DATABASE_PASSWORD=change-me-local-only -e DATABASE_SSL=false ai-sdlc-platform
curl localhost:8080/ready
```

The image is multi-stage on `node:24-slim`, installs production dependencies only, runs as the non-root `node` user and listens on `8080`. It includes `config/`, `migrations/` and the RDS CA bundle. `PLATFORM_ENV` and the database variables have no defaults in the image, so the container refuses to start without them.

The base image is pinned by digest (`node:24-slim@sha256:…`) so every build uses the same base and it never changes silently. The pin is the multi-arch index digest, so it works on amd64 and arm64. To pick up Node or Debian fixes, refresh it:

1. Run `docker buildx imagetools inspect node:24-slim` and copy the top-level `Digest:` line (the index, not one of the per-platform manifests listed below it).
2. Replace the digest in **both** `FROM` lines of the `Dockerfile`.
3. Rebuild, run the container and check `/health` (CI's `container` job does the same on the PR).

## Infrastructure

`infra/` defines three stacks per app run. Stacks set no account or region, so they come from the credentials you deploy with.

| Stack                             | Purpose                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ai-sdlc-platform-registry-<env>` | ECR repository (scan on push, immutable tags, lifecycle rule). Separate so the image can be pushed before the service exists.                                                                                                                                                                                                                                                              |
| `ai-sdlc-platform-<env>`          | VPC (2 AZs; public, private and isolated subnets), ECS cluster, Fargate service behind an ALB checked on `/health`, RDS for PostgreSQL 17 (`db.t4g.micro`, private, encrypted, 7-day backups; multi-AZ and deletion-protected in prod), S3 artifact bucket (private, encrypted, versioned, TLS only; retained in prod), log group, circuit-breaker rollback, placeholder model-key secret. |
| `ai-sdlc-platform-github-oidc`    | GitHub OIDC provider and the deploy role (once per AWS account).                                                                                                                                                                                                                                                                                                                           |

`<env>` is `platform-dev` or `platform-prod`, chosen with `-c platformEnv=...`. Dev uses one NAT gateway and one task; prod uses two of each and turns on Container Insights.

## First AWS deployment

These steps are done once by the owner. Claude Code cannot do them.

1. **Pick the account and region**, then configure the AWS CLI for it.
2. **Bootstrap CDK** in that account and region: `cd infra && npx cdk bootstrap`. The deploy role assumes the default `cdk-hnb659fds-*` bootstrap roles; if you bootstrap with a different qualifier, change `CDK_BOOTSTRAP_QUALIFIER` in `infra/lib/constants.js`.
3. **Deploy the OIDC stack** locally (the workflow cannot create its own role): `cd infra && npx cdk deploy ai-sdlc-platform-github-oidc`. The deploy role ARN is `arn:aws:iam::<account-id>:role/ai-sdlc-platform-github-deploy` (an IAM role ARN, not the stack's CloudFormation ARN). The role trusts the repo's OIDC subject prefix from `cdk.json` (`githubSubjectPrefix`). This repo uses GitHub's immutable subject claims, so the prefix includes owner and repo IDs (`repo:TsepoG@66557542/ai-sdlc-platform@1423470779`). For another repo, read its prefix with `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` (field `sub_claim_prefix`) and pass `-c githubSubjectPrefix=<prefix>`.
4. **Create GitHub environments** `platform-dev` and `platform-prod` (Settings → Environments).
   - Set each environment's **deployment branches** to `main` only. The role trusts `<subject prefix>:environment:<name>`, so this policy is what keeps environment jobs on `main`.
   - Add required reviewers to `platform-prod`.
5. **Add variables to both environments:** `AWS_DEPLOY_ROLE_ARN` (from step 3) and `AWS_REGION`.
6. **Enable deploys:** add the **repository** variable `PLATFORM_DEPLOY_ENABLED` with the value `true` (Settings → Secrets and variables → Actions → Variables). Unless it is `true`, the deploy workflow skips every run; set it to `false` to pause deploys.
7. **Run the deploy.** Merging to `main` deploys `platform-dev` after CI passes. For prod, run the **Deploy platform** workflow manually and choose `platform-prod`. The workflow deploys the registry, builds and pushes the image tagged with the commit SHA, deploys the platform, then checks that `/health` reports that SHA.
8. **Set the model API key** (when the provider route is decided) by putting the real value in the Secrets Manager secret `ai-sdlc-platform/<env>/model-api-key`. It currently holds the placeholder `REPLACE_ME_SET_MANUALLY` and is not injected into the service.

> **Warning:** the ALB is public and serves plain HTTP. It must be put behind SSO, or made internal, before any real data is used with the platform.

### Current status: platform dev is paused

The pipeline deployed platform dev successfully. To save cost, the platform stack (`ai-sdlc-platform-platform-dev`: VPC, NAT gateway, ALB and service) was destroyed on 26 Nov 2026, and `PLATFORM_DEPLOY_ENABLED` is `false`, so merges to `main` run CI but don't deploy. The registry stack, the GitHub OIDC stack and the CDK bootstrap remain.

To bring dev back (planned for Phase 02, about 7 Dec 2026): set the repository variable `PLATFORM_DEPLOY_ENABLED` to `true`, then merge to `main`. The workflow recreates the platform stack, now with the RDS database and S3 bucket, and its smoke test checks `/health`, `/ready`, `/stages` (seven stages) and that the workflow routes return 404. The ALB gets a new URL each time it is recreated.

**Cost note:** RDS adds roughly $15–30/month to dev (single-AZ `db.t4g.micro`, 20 GB gp3, the secret); prod's multi-AZ instance costs about twice the instance price. S3 costs pennies at this scale. These are estimates: check current `af-south-1` prices before relying on them.

## CI

`ci.yml` runs on pull requests and on pushes to `main`: format check, lint, typecheck, unit tests with the 90% coverage threshold (together the same as `npm run verify`), `npm run audit`, `cdk synth`, then the SonarQube scan. The verify job runs the database tests against a PostgreSQL 17 service container. A second job builds the Docker image, runs it against the same kind of database and checks `/health`, `/ready`, that `/stages` lists the seven stages, and that the workflow routes are not registered. Add the repository secret `SONAR_TOKEN` and the repository variables `SONAR_ORGANIZATION` and `SONAR_PROJECT_KEY` to enable the scan (SonarQube Cloud needs no host URL); until all three are set, CI prints a notice and skips it. For self-hosted SonarQube Server, also pass a `SONAR_HOST_URL` secret to the scan step and drop the organization argument.

## Placeholders to fill in

- GitHub secret `SONAR_TOKEN`, and repository variables `SONAR_ORGANIZATION` and `SONAR_PROJECT_KEY`.
- GitHub environment variables `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION` (per environment).
- AWS account and region (supplied by your credentials; nothing is hard-coded).
- Secrets Manager `ai-sdlc-platform/<env>/model-api-key` value.

## Working with Claude Code

Claude Code never merges, rebases, resets or tags, and never pushes to `main` or force-pushes; `.claude/settings.json` denies those commands and clears AI attribution. In interactive sessions the owner makes every commit and push. Unattended cloud sessions may commit to the phase branch, push it and open a draft PR, with every commit authored by the owner (CODING_PRINCIPLES.md section 8). See [CLAUDE.md](CLAUDE.md).
