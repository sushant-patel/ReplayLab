-- ReplayLab schema. Idempotent (IF NOT EXISTS): safe to run on every start.
--
--   replay_runs 1 ──< request_results 1 ──< differences
--
-- One run has many request results; one result has many differences.

CREATE TABLE IF NOT EXISTS replay_runs (
  id              BIGSERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ      NOT NULL,
  finished_at     TIMESTAMPTZ      NOT NULL,
  baseline_url    TEXT             NOT NULL,
  candidate_url   TEXT             NOT NULL,
  concurrency     INT              NOT NULL,
  total_requests  INT              NOT NULL,
  passed          INT              NOT NULL,
  failed          INT              NOT NULL,
  errored         INT              NOT NULL,
  gate_passed     BOOLEAN          NOT NULL,
  summary         JSONB            NOT NULL  -- full metrics snapshot (percentiles, routes, gate reasons)
);

-- "Show the latest runs" sorts by time: index it.
CREATE INDEX IF NOT EXISTS idx_replay_runs_started_at ON replay_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS request_results (
  id                    BIGSERIAL PRIMARY KEY,
  run_id                BIGINT  NOT NULL REFERENCES replay_runs (id) ON DELETE CASCADE,
  request_id            TEXT    NOT NULL,
  method                TEXT    NOT NULL,
  path                  TEXT    NOT NULL,
  verdict               TEXT    NOT NULL CHECK (verdict IN ('pass', 'fail', 'error')),
  baseline_status       INT,               -- NULL when the request got no response
  candidate_status      INT,
  baseline_latency_ms   DOUBLE PRECISION,
  candidate_latency_ms  DOUBLE PRECISION,
  baseline_error        TEXT,
  candidate_error       TEXT,
  UNIQUE (run_id, request_id)              -- also serves as the index for "all results of run X"
);

-- "Show only failures of run X": composite index matches WHERE run_id = ? AND verdict = ?
CREATE INDEX IF NOT EXISTS idx_request_results_run_verdict ON request_results (run_id, verdict);

CREATE TABLE IF NOT EXISTS differences (
  id               BIGSERIAL PRIMARY KEY,
  result_id        BIGINT NOT NULL REFERENCES request_results (id) ON DELETE CASCADE,
  kind             TEXT   NOT NULL,
  json_path        TEXT   NOT NULL,
  severity         TEXT   NOT NULL CHECK (severity IN ('breaking', 'warning')),
  baseline_value   JSONB,  -- SQL NULL = side had no value; JSON 'null' = value was null
  candidate_value  JSONB
);

-- Foreign keys are NOT indexed automatically in Postgres; joins/cascades need this.
CREATE INDEX IF NOT EXISTS idx_differences_result_id ON differences (result_id);
-- "Which runs had missing fields?" queries filter by kind.
CREATE INDEX IF NOT EXISTS idx_differences_kind ON differences (kind);
