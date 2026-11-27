-- 0001: initial schema for Initiatives, stage runs, versions, review packages, decisions,
-- jobs and the audit chain (core-design.md section 6). Names no schema, so it applies to
-- whichever schema is first on the search_path.

-- Rows that must never change once written. The application never updates or deletes them;
-- this makes the database refuse it too.
CREATE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is insert-only', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE SEQUENCE initiative_key_seq;

CREATE TABLE initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE
    DEFAULT 'INI-' || lpad(nextval('initiative_key_seq')::text, 4, '0'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  requester_id text NOT NULL,
  owner_id text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('active', 'on_hold', 'awaiting_stage', 'done', 'cancelled')),
  current_stage_key text NOT NULL,
  flags jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(flags) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL REFERENCES initiatives (id),
  stage_key text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  state text NOT NULL
    CHECK (state IN ('active', 'approved', 'superseded', 'upstream_changed', 'cancelled')),
  -- SHA-256 of the stage definition this run follows, so later config changes don't rewrite history.
  config_version text NOT NULL CHECK (config_version ~ '^[0-9a-f]{64}$'),
  -- The approved upstream package this run started from; FK added after review_packages exists.
  input_package_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (initiative_id, stage_key, attempt)
);
CREATE INDEX stage_runs_initiative_idx ON stage_runs (initiative_id);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL REFERENCES initiatives (id),
  stage_run_id uuid NOT NULL REFERENCES stage_runs (id),
  type text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_stage_run_idx ON artifacts (stage_run_id);

CREATE TABLE artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES artifacts (id),
  number integer NOT NULL CHECK (number > 0),
  content_key text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  format text NOT NULL CHECK (format IN ('markdown', 'text', 'json')),
  created_by_type text NOT NULL CHECK (created_by_type IN ('agent', 'user')),
  created_by_id text NOT NULL,
  source_version_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, number)
);
CREATE TRIGGER artifact_versions_insert_only BEFORE UPDATE OR DELETE ON artifact_versions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER artifact_versions_no_truncate BEFORE TRUNCATE ON artifact_versions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TABLE review_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_run_id uuid NOT NULL REFERENCES stage_runs (id),
  package_hash text NOT NULL CHECK (package_hash ~ '^[0-9a-f]{64}$'),
  submitted_by text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL
    CHECK (status IN ('open', 'approved', 'changes_requested', 'rejected', 'superseded'))
);
-- At most one open package per stage run: a retried submission can't open a second one.
CREATE UNIQUE INDEX review_packages_one_open_idx ON review_packages (stage_run_id)
  WHERE status = 'open';

ALTER TABLE stage_runs
  ADD CONSTRAINT stage_runs_input_package_fk
  FOREIGN KEY (input_package_id) REFERENCES review_packages (id);

-- A package's contents are fixed at submission.
CREATE TABLE review_package_versions (
  package_id uuid NOT NULL REFERENCES review_packages (id),
  version_id uuid NOT NULL REFERENCES artifact_versions (id),
  PRIMARY KEY (package_id, version_id)
);
CREATE TRIGGER review_package_versions_insert_only
  BEFORE UPDATE OR DELETE ON review_package_versions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER review_package_versions_no_truncate BEFORE TRUNCATE ON review_package_versions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TABLE step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_run_id uuid NOT NULL REFERENCES stage_runs (id),
  step_key text NOT NULL,
  step_type text NOT NULL CHECK (step_type IN ('action', 'work', 'gate')),
  position integer NOT NULL CHECK (position >= 0),
  -- Restarting a stage (changes requested) opens a new cycle of step runs.
  cycle integer NOT NULL CHECK (cycle > 0),
  state text NOT NULL
    CHECK (state IN ('pending', 'running', 'waiting', 'done', 'failed', 'skipped')),
  package_id uuid REFERENCES review_packages (id),
  external_run_id text,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (stage_run_id, cycle, step_key)
);

CREATE TABLE gate_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_run_id uuid NOT NULL REFERENCES step_runs (id),
  package_id uuid NOT NULL REFERENCES review_packages (id),
  approver_role text NOT NULL,
  state text NOT NULL CHECK (state IN ('open', 'decided', 'cancelled')),
  assignee_id text,
  due_at timestamptz,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
-- A resubmission can reopen a step's gate on a new package, but only one gate run per step is
-- ever open at a time.
CREATE UNIQUE INDEX gate_runs_one_open_idx ON gate_runs (step_run_id) WHERE state = 'open';

CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One decision per gate run: of two concurrent decisions, exactly one can be recorded.
  gate_run_id uuid NOT NULL UNIQUE REFERENCES gate_runs (id),
  package_hash text NOT NULL CHECK (package_hash ~ '^[0-9a-f]{64}$'),
  reviewer_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('approve', 'request_changes', 'reject')),
  rework_target text CHECK (rework_target IS NULL OR outcome = 'reject'),
  feedback text,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER decisions_insert_only BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER decisions_no_truncate BEFORE TRUNCATE ON decisions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TABLE open_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES artifact_versions (id),
  text text NOT NULL CHECK (length(text) > 0),
  blocking boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'answered')),
  answer text,
  answered_by_id text,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'answered') = (answer IS NOT NULL AND answered_by_id IS NOT NULL))
);
CREATE INDEX open_questions_version_idx ON open_questions (version_id);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES artifact_versions (id),
  anchor jsonb,
  author_id text NOT NULL,
  body text NOT NULL CHECK (length(body) > 0),
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_run_id uuid NOT NULL REFERENCES stage_runs (id),
  agent_key text NOT NULL,
  agent_version text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  template_version text NOT NULL,
  input_version_ids uuid[] NOT NULL DEFAULT '{}',
  output_version_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  duration_ms integer CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Outbox and background work.
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  decision_id uuid REFERENCES decisions (id),
  step_run_id uuid REFERENCES step_runs (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs (run_after) WHERE status = 'pending';

CREATE TABLE external_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  system text NOT NULL CHECK (system IN ('jira', 'confluence', 'figma', 'github', 'teams')),
  external_id text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (system, external_id)
);

CREATE TABLE audit_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  initiative_id uuid,
  data jsonb NOT NULL DEFAULT '{}',
  prev_hash text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX audit_events_initiative_idx ON audit_events (initiative_id, seq);
CREATE TRIGGER audit_events_insert_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- The single row every audit append locks, so appends are serialised and the chain can't fork.
CREATE TABLE audit_chain_head (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_seq bigint NOT NULL,
  last_hash text NOT NULL CHECK (last_hash ~ '^[0-9a-f]{64}$')
);
INSERT INTO audit_chain_head (id, last_seq, last_hash) VALUES (true, 0, repeat('0', 64));
