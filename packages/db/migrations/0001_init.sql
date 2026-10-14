-- 0001_init: toàn bộ schema SPEC-00 §8 (ProfileVault M0)
-- Mỗi câu lệnh kết thúc bằng ';' trên dòng riêng; bộ áp migration tách theo ';\n'.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_json TEXT,
  new_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE bindings (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  fury_profile_id TEXT NOT NULL UNIQUE,
  market_country TEXT NOT NULL,
  pack_config_json TEXT NOT NULL DEFAULT '{}',
  allowed_roots_json TEXT NOT NULL DEFAULT '[]',
  level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 3),
  level_since TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (platform, account_id)
);

CREATE TABLE binding_pauses (
  id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  reason TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  cleared_at TEXT,
  cleared_by TEXT
);
CREATE INDEX ix_pauses_open ON binding_pauses(binding_id) WHERE cleared_at IS NULL;

CREATE TABLE level_changes (
  id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  from_level INTEGER NOT NULL,
  to_level INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('promote','demote')),
  reason TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE health_events (
  id TEXT PRIMARY KEY,
  binding_id TEXT REFERENCES bindings(id),
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  source TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX ix_events_binding_time ON health_events(binding_id, occurred_at);

CREATE TABLE proxy_checks (
  id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  ok INTEGER NOT NULL,
  exit_ip TEXT,
  country TEXT,
  city TEXT,
  timezone TEXT,
  asn INTEGER,
  asn_org TEXT,
  asn_type TEXT,
  latency_ms INTEGER,
  error TEXT,
  checked_at TEXT NOT NULL
);

CREATE TABLE asn_attestations (
  asn INTEGER PRIMARY KEY,
  asn_type TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE probe_results (
  id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  fury_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual_import','flow')),
  captured_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  raw_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE detect_suite_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fury_version TEXT NOT NULL,
  binding_id TEXT REFERENCES bindings(id),
  passed INTEGER NOT NULL,
  summary TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TABLE account_checklists (
  binding_id TEXT PRIMARY KEY REFERENCES bindings(id),
  account_region TEXT,
  channel_country TEXT,
  account_language TEXT,
  recovery_email_hmac TEXT,
  recovery_phone_hmac TEXT,
  twofa_enabled INTEGER,
  exclusive_login_confirmed INTEGER,
  studio_language_set INTEGER,
  confirmed_at TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE host_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  os TEXT NOT NULL,
  os_version TEXT NOT NULL,
  gpus_json TEXT NOT NULL,
  displays_json TEXT NOT NULL,
  ram_mb INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE TABLE consistency_rules (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,
  severity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  params_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE consistency_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE consistency_results (
  run_id TEXT NOT NULL REFERENCES consistency_runs(id),
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  rule_id TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  actual_json TEXT,
  expected_json TEXT,
  hint TEXT,
  PRIMARY KEY (run_id, binding_id, rule_id)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  idempotency_key TEXT NOT NULL,
  input_json TEXT NOT NULL,
  mode TEXT,
  status TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  error_detail_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (client_id, idempotency_key)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  flow_id TEXT NOT NULL,
  flow_version TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  checkpoint_json TEXT,
  needs_user_json TEXT,
  launched_by_run INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  error_detail_json TEXT,
  artifacts_dir TEXT
);

CREATE TABLE run_steps (
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  target_json TEXT NOT NULL,
  days_of_week TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  flow_filter_json TEXT NOT NULL DEFAULT '["*"]',
  binding_filter_json TEXT NOT NULL DEFAULT '["*"]',
  rate_limit_per_min INTEGER NOT NULL DEFAULT 120,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
