-- Short-lived leases so only one process at a time runs a background job (for example
-- metadata enrichment) when several servers share the database: a long-running server
-- and serverless functions. A lease is taken by upsert only when it has expired or is
-- already held by the same holder, and is released (deleted) when the work is done.
CREATE TABLE worker_leases (
  name       TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
