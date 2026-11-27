# 0003. Stage configuration as YAML files in the repository

**Status:** Accepted (2026-11-27).

## Context

The platform's first design principle is that stages are configuration, not engine code: each stage's inputs, outputs, agent, ordered steps, conditions and rework targets must be changeable without touching `src/workflow`. That configuration needs a home and a format.

The options considered were:

1. **Files in this repository** (YAML or JSON), loaded at startup.
2. **Rows in the database**, edited through an admin API or UI.
3. **JavaScript modules** exporting the stage objects.

Stage changes alter how every Initiative is governed, so they need review, history and a way to roll back. Roles (core-design.md section 9) already say that platform admins change stage configuration and routing "via reviewed PRs".

## Decision

Stage configuration lives in `config/stages/NN-<key>.yaml`, one file per stage, in this repository. AI routing follows the same pattern in `config/routing.yaml`.

- **Reviewed and versioned with the code.** A stage change is a pull request: it is reviewed, runs CI (which loads and validates every file), and ships in the same image as the engine that reads it. Git history is the audit trail of configuration changes, and a revert is a rollback.
- **Validated at the boundary.** `src/stages` parses each file and validates it with Zod (per-stage rules), then checks the set as a whole (unique order and keys; inputs and rework targets point only at earlier stages that exist). The server refuses to start on invalid configuration, so a bad change fails in CI and in the container check, never at decision time.
- **YAML, parsed with the `yaml` package.** Node has no built-in YAML parser. YAML suits hand-edited configuration: comments explain intent (for example why the TDF steps are conditional), and the step lists read clearly. JSON has no comments; JavaScript modules would let configuration run code and blur the line the principle draws. `yaml` (eemeli/yaml) is actively maintained, has no dependencies, ships its own types, follows YAML 1.2 (so `no` and `on` are strings, not booleans) and rejects duplicate keys by default.

## Consequences

- Changing a stage needs a PR and a deploy; there is no runtime editing. That is intended for now. If runtime editing is ever needed, the database would hold copies published from these files, not replace them.
- Each StageRun will record the configuration version it ran with (Phase 02), so later config changes don't rewrite history for Initiatives already in flight.
- The engine trusts validated configuration: conditions are checked at load time, so `evaluateCondition` never meets a malformed condition in normal operation.
- In YAML, a `${NAME}` placeholder in `config/routing.yaml` must be quoted, because braces are YAML flow syntax.
- One more production dependency (`yaml`), pinned by the lockfile and covered by `npm audit`.
