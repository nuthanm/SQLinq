CREATE TABLE IF NOT EXISTS benchmark_runs (
  id BIGSERIAL PRIMARY KEY,
  suite_version TEXT NOT NULL,
  release_target TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  totals JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS benchmark_queries (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  query_id TEXT NOT NULL,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  convert_status TEXT NOT NULL,
  correctness NUMERIC(5,2) NOT NULL,
  exact_match BOOLEAN NOT NULL,
  time_ms NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL,
  issue_ref TEXT,
  failure_reason TEXT,
  release_bucket TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benchmark_runs_generated_at ON benchmark_runs(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_queries_run_id ON benchmark_queries(run_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_queries_status ON benchmark_queries(status);

CREATE TABLE IF NOT EXISTS conversion_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  connectivity_mode TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  convert_status TEXT NOT NULL,
  correctness NUMERIC(5,2),
  exact_match BOOLEAN,
  time_ms NUMERIC(10,2),
  issue_ref TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversion_events_created_at ON conversion_events(created_at DESC);
