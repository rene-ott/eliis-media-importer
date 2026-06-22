/**
 * Schema definition + initialization. Idempotent: safe to run on every start.
 *
 * Note: `current_date` collides with SQLite's CURRENT_DATE keyword, so it is
 * always written quoted (`"current_date"`) in DDL and queries.
 */

import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_SQL = `
-- Rollback-journal mode (the SQLite default) is used rather than WAL: this is a
-- single-process CLI, and WAL relies on shared-memory mapping that some
-- filesystems (e.g. network/9p mounts) don't support. foreign_keys is enabled
-- so the request<->media relationships are enforced.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  param_date         TEXT    NOT NULL,                 -- date sent as ?date=
  "current_date"     TEXT,                             -- cursor used for this run
  next_date          TEXT,                             -- cursor returned by response
  status             TEXT    NOT NULL DEFAULT 'pending', -- pending | success | error
  success            INTEGER NOT NULL DEFAULT 0,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  http_status        INTEGER,
  error_message      TEXT,
  duration_ms        INTEGER,
  media_file_count   INTEGER NOT NULL DEFAULT 0,
  raw_response_saved INTEGER NOT NULL DEFAULT 0,
  raw_response_path  TEXT,
  kindergarten_id    TEXT,
  child_id           TEXT,
  response_hash      TEXT,                             -- sha256 of raw body
  started_at         TEXT,
  finished_at        TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests (created_at);
CREATE INDEX IF NOT EXISTS idx_requests_status     ON requests (status);
CREATE INDEX IF NOT EXISTS idx_requests_param_date ON requests (param_date);

CREATE TABLE IF NOT EXISTS media_files (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id           INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  api_media_id         TEXT,                           -- original images[].id
  mime_type            TEXT,
  media_kind           TEXT,                           -- image | video | other
  url                  TEXT,
  name                 TEXT,
  filename             TEXT,
  description          TEXT,
  summary_description  TEXT,                           -- plain text (HTML stripped)
  summary_html         TEXT,                           -- raw summary HTML (optional)
  feed_date            TEXT,                           -- data[].date
  diary_id             INTEGER,
  text_id              INTEGER,
  uploaded_at          TEXT,
  size                 INTEGER,
  thumbnail_small_url  TEXT,
  thumbnail_medium_url TEXT,
  raw_json             TEXT,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Canonical de-duplication: prefer api_media_id, fall back to url.
-- One canonical row per media file; request_id is the FIRST request that saw it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_media_dedup
  ON media_files (COALESCE(api_media_id, url));

CREATE INDEX IF NOT EXISTS idx_media_request   ON media_files (request_id);
CREATE INDEX IF NOT EXISTS idx_media_feed_date ON media_files (feed_date);
CREATE INDEX IF NOT EXISTS idx_media_kind      ON media_files (media_kind);

-- Optional join table: records every (request, media) occurrence, so we can
-- tell that the same media file appeared in multiple API responses.
CREATE TABLE IF NOT EXISTS request_media_files (
  request_id    INTEGER NOT NULL REFERENCES requests(id)    ON DELETE CASCADE,
  media_file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  seen_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (request_id, media_file_id)
);

CREATE INDEX IF NOT EXISTS idx_rmf_media ON request_media_files (media_file_id);
`;

export function runMigrations(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
}
