# ai-sdlc-platform

An internal **AI-assisted SDLC platform**. For each Initiative (a feature or change request), a stage-specific AI agent drafts the artifacts for that stage, and a named human approves the exact version before work moves on.

Seven stages: **Brief → UX design → Tech design → Work breakdown → Build → Deploy → Test**. Jira, Confluence, Figma and GitHub stay the systems of record. The platform runs on AWS and the AI layer is vendor-neutral.

**Status:** Phase 00 (repository foundation). The repo contains the tooling, shared foundations (config, errors, logger), a Fastify `GET /health` API, a container image, AWS CDK stacks and the CI/CD workflows. No stage logic exists yet; see [docs/phases/ROADMAP.md](docs/phases/ROADMAP.md).

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
- Docker, to build and run the container.
- For the first deployment only: an AWS account, the AWS CLI, and permission to bootstrap CDK.

## Setup

```bash
npm ci
cp .env.example .env     # then adjust; .env is git-ignored
npm start                # loads .env if present, listens on PORT
curl localhost:8080/health
```

`GET /health` returns `{ "status": "ok", "version": "<APP_VERSION>" }`.

## Configuration

`src/config` is the only code that reads the environment, and it validates everything with Zod at startup. Missing or invalid values stop the process with a `ConfigError` that names the variable (never its value). `.env.example` lists every variable.

| Variable       | Values                                   | Default | Notes                                         |
| -------------- | ---------------------------------------- | ------- | --------------------------------------------- |
| `NODE_ENV`     | `development`, `test`, `production`      | none    | required                                      |
| `PORT`         | 1-65535                                  | `8080`  |                                               |
| `LOG_LEVEL`    | `fatal` … `trace`, `silent`              | `info`  |                                               |
| `APP_VERSION`  | any non-empty string                     | none    | reported by `/health`; CI sets the commit SHA |
| `PLATFORM_ENV` | `local`, `platform-dev`, `platform-prod` | none    | required                                      |

## Scripts

| Script                  | What it does                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `npm run verify`        | `format:check`, `lint`, `typecheck`, `test:coverage` (run this before every commit) |
| `npm run lint`          | ESLint, zero warnings allowed                                                       |
| `npm run format`        | Prettier, write                                                                     |
| `npm run format:check`  | Prettier, check only                                                                |
| `npm run typecheck`     | `tsc --noEmit` over the JSDoc types (`checkJs`, `strict`)                           |
| `npm test`              | Vitest, excluding tests tagged `live`                                               |
| `npm run test:coverage` | Vitest with coverage; fails below 90% for lines, branches, functions, statements    |
| `npm run test:live`     | Only tests tagged `live` (none yet)                                                 |
| `npm run audit`         | `npm audit --audit-level=high`                                                      |
| `npm start`             | Run the API locally                                                                 |

CDK commands run from `infra/`: `cd infra && npx cdk synth`. Synth needs no AWS credentials.

## Layout

```
src/
  config/    environment loading and validation (only place reading process.env)
  errors/    AppError, ConfigError
  logger/    structured JSON logger (pino)
  server/    Fastify app factory, /health, error handling, main.js entry point
test/        mirrors src/, plus test/infra and test/lint (lint-boundary tests)
infra/       AWS CDK (JavaScript): registry, platform and GitHub OIDC stacks
.github/     ci.yml and deploy-platform.yml
docs/        design, phases, decisions
```

Each `src/` folder exposes only its `index.js`; import from there, not from internal files.

## Enforced boundaries

ESLint enforces two rules from the coding principles, and tests prove they fire (`test/lint/boundaries.test.js`):

- AI vendor SDKs (`@anthropic-ai/*`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock*`, `@mistralai/*`, `cohere-ai`) can only be imported under `src/ai-adapters/<vendor>/`.
- `process.env` (including `import { env } from 'node:process'`) can only be used in `src/config/`.

## Container

```bash
docker build --build-arg APP_VERSION=local -t ai-sdlc-platform .
docker run --rm -p 8080:8080 -e PLATFORM_ENV=local ai-sdlc-platform
curl localhost:8080/health
```

The image is multi-stage on `node:24-slim`, installs production dependencies only, runs as the non-root `node` user and listens on `8080`. `PLATFORM_ENV` has no default in the image, so the container refuses to start without it.

## Infrastructure

`infra/` defines three stacks per app run. Stacks set no account or region, so they come from the credentials you deploy with.

| Stack                             | Purpose                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ai-sdlc-platform-registry-<env>` | ECR repository (scan on push, immutable tags, lifecycle rule). Separate so the image can be pushed before the service exists.                    |
| `ai-sdlc-platform-<env>`          | VPC (2 AZs), ECS cluster, Fargate service behind an ALB checked on `/health`, log group, circuit-breaker rollback, placeholder model-key secret. |
| `ai-sdlc-platform-github-oidc`    | GitHub OIDC provider and the deploy role (once per AWS account).                                                                                 |

`<env>` is `platform-dev` or `platform-prod`, chosen with `-c platformEnv=...`. Dev uses one NAT gateway and one task; prod uses two of each and turns on Container Insights.

## First AWS deployment

These steps are done once by the owner. Claude Code cannot do them.

1. **Pick the account and region**, then configure the AWS CLI for it.
2. **Bootstrap CDK** in that account and region: `cd infra && npx cdk bootstrap`. The deploy role assumes the default `cdk-hnb659fds-*` bootstrap roles; if you bootstrap with a different qualifier, change `CDK_BOOTSTRAP_QUALIFIER` in `infra/lib/constants.js`.
3. **Deploy the OIDC stack** locally (the workflow cannot create its own role): `cd infra && npx cdk deploy ai-sdlc-platform-github-oidc`. Note the deploy role ARN from the IAM console (`ai-sdlc-platform-github-deploy`). If your GitHub repo is not `TsepoG/ai-sdlc-platform`, pass `-c githubRepo=<owner>/<repo>`.
4. **Create GitHub environments** `platform-dev` and `platform-prod` (Settings → Environments).
   - Set each environment's **deployment branches** to `main` only. The role trusts `repo:<owner>/<repo>:environment:<name>`, so this policy is what keeps environment jobs on `main`.
   - Add required reviewers to `platform-prod`.
5. **Add variables to both environments:** `AWS_DEPLOY_ROLE_ARN` (from step 3) and `AWS_REGION`.
6. **Enable deploys:** add the **repository** variable `PLATFORM_DEPLOY_ENABLED` with the value `true` (Settings → Secrets and variables → Actions → Variables). Until it is set, the deploy workflow skips every run.
7. **Run the deploy.** Merging to `main` deploys `platform-dev` after CI passes. For prod, run the **Deploy platform** workflow manually and choose `platform-prod`. The workflow deploys the registry, builds and pushes the image tagged with the commit SHA, deploys the platform, then checks that `/health` reports that SHA.
8. **Set the model API key** (when the provider route is decided) by putting the real value in the Secrets Manager secret `ai-sdlc-platform/<env>/model-api-key`. It currently holds the placeholder `REPLACE_ME_SET_MANUALLY` and is not injected into the service.

> **Warning:** the ALB is public and serves plain HTTP. It must be put behind SSO, or made internal, before any real data is used with the platform.

## CI

`ci.yml` runs on pull requests and on pushes to `main`: install, `npm run verify`, `npm run audit`, `cdk synth`, then the SonarQube scan. Add the repository secret `SONAR_TOKEN` and the repository variables `SONAR_ORGANIZATION` and `SONAR_PROJECT_KEY` to enable the scan (SonarQube Cloud needs no host URL); until all three are set, CI prints a notice and skips it. For self-hosted SonarQube Server, also pass a `SONAR_HOST_URL` secret to the scan step and drop the organization argument.

## Placeholders to fill in

- GitHub secret `SONAR_TOKEN`, and repository variables `SONAR_ORGANIZATION` and `SONAR_PROJECT_KEY`.
- GitHub environment variables `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION` (per environment).
- AWS account and region (supplied by your credentials; nothing is hard-coded).
- Secrets Manager `ai-sdlc-platform/<env>/model-api-key` value.
- `Dockerfile`: pin the base image by digest.

## Working with Claude Code

Claude Code never commits, pushes, merges, rebases, resets or tags; `.claude/settings.json` denies those commands and clears AI attribution. See [CLAUDE.md](CLAUDE.md).
