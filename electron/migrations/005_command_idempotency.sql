CREATE TABLE IF NOT EXISTS command_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  client_request_id TEXT NOT NULL,
  command TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_command_log_created ON command_log(created_at);

CREATE TABLE IF NOT EXISTS migration_checksums (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
