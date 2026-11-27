# 0004. Workflow state in PostgreSQL; durable workflow engine deferred

**Status:** Proposed (2026-11-27), for the owner to accept with the Phase 02 PR.

## Context

The core design proposed Temporal as the durable workflow engine, with hosting left open (Temporal Cloud, self-hosted Temporal on ECS, or AWS Step Functions). For the MVP, the workflow is the Brief stage: draft, submit, review, decide. The long waits are for people to approve, which can take days. There are no automated deployment steps, GitHub Actions callbacks or SLA timers yet.

A workflow engine would add a service to run, secure and pay for, plus a second source of truth for workflow state beside the database. The Phase 01 rules (`nextMove`, hashing, decision rights) are pure functions that don't depend on any engine.

## Decision

Workflow state lives in PostgreSQL. There is no separate workflow engine for the MVP.

- **A wait is a row, not a running process.** An open gate is a `gate_runs` row; nothing runs while a reviewer thinks.
- **Every transition is one transaction.** A service loads state, asks the Phase 01 rules what happens (`nextMove`, `assertCurrentPackage`, `assertCanDecide`), and writes the result together with its audit events. Each service locks the Initiative row first. Its audit events are buffered and appended together just before commit, so the audit chain head is always the last lock taken and is held only briefly. Changes to one Initiative are serialised, and locks are always taken in the same order.
- **Rework supersedes; re-approval starts afresh.** Following core-design section 5, a rejection with a rework target supersedes every later stage run, approved or active, and re-approving the target starts new downstream attempts. The `upstream_changed` state is reserved for when an approved artifact gets a new version, which arrives in a later phase. This was decided by the owner during the Phase 02 review; it replaces the phase file's "flag on re-approval" rule.
- **Background work goes through the outbox.** A `jobs` table, claimed with `FOR UPDATE SKIP LOCKED` by a small worker in the same service process. It retries with exponential backoff and marks a job failed after the last attempt. A running job renews its lease, and a job whose worker died is reclaimed only while attempts remain. Jobs are enqueued in the transaction that causes them, keyed by an idempotency key. Phase 02 registers only a `log` handler; agent runs (Phase 03) and MS Teams notifications (Phase 05) add more.
- **The database enforces the guarantees, not only the code.** `artifact_versions`, `decisions`, `audit_events` and `review_package_versions` are insert-only (triggers reject UPDATE, DELETE and TRUNCATE). One open package per stage run, one open gate run per step, one decision per gate run, and unique job idempotency keys make retries safe.

A durable engine (Step Functions or Temporal) is reconsidered at the **Build slice**, when GitHub Actions action steps, their callbacks and SLA timers arrive. Because the rules are pure and the state is in PostgreSQL, adopting an engine then means moving orchestration into it, not rewriting the rules.

## Required before real data (Phase 05)

**Split the database roles.** Today the service connects as the RDS master user, which owns the tables, and migrations run as that same user. A table owner can `ALTER TABLE … DISABLE TRIGGER`, so the insert-only triggers stop accidents and application bugs but not a compromised service. The audit chain's tamper test simulates exactly this. Before any real company data is used:

- a **migration-owner role** owns the schema and runs migrations (a one-off task or deploy step);
- an **application role**, used by the service, has only `SELECT`, `INSERT` and the `UPDATE`s it needs, does not own any table, and cannot disable triggers;
- the master user is used for neither.

## Consequences

- No engine to host, secure or pay for in the MVP; one source of truth for workflow state.
- Throughput per Initiative is limited by the row lock, which is fine at the MVP scale (10–20 active Initiatives) and keeps reasoning simple.
- Timers (SLA reminders) and external callbacks are not handled yet; `gate_runs.due_at` is stored so they can be added.
- The worker runs inside the API process. With two prod tasks, two workers poll; `SKIP LOCKED` makes that safe, and a lease lets another worker reclaim a job whose task died.
- Tests run against a real PostgreSQL (one schema per test file), so `npm run verify` now needs one: `docker compose up -d` locally, a service container in CI.
