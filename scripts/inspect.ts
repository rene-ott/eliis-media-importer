/**
 * Quick read-only inspector for the importer's SQLite database.
 *
 * Usage:
 *   node scripts/inspect.ts [dbPath]        (default: ./eliis.sqlite)
 *   node scripts/inspect.ts ./eliis.sqlite
 *   node scripts/inspect.ts "C:/Users/you/eliis.sqlite"
 *
 * It never writes — safe to run while nothing else is using the DB.
 */

import { DatabaseSync } from 'node:sqlite';

const dbPath = process.argv[2] ?? './eliis.sqlite';

let db: DatabaseSync;
try {
  db = new DatabaseSync(dbPath, { readOnly: true });
} catch (err) {
  console.error(`Could not open database "${dbPath}": ${(err as Error).message}`);
  console.error('Pass the path explicitly, e.g. node scripts/inspect.ts ./eliis.sqlite');
  process.exit(1);
}

const one = <T>(sql: string, ...params: unknown[]): T =>
  db.prepare(sql).get(...(params as never[])) as T;
const all = <T>(sql: string, ...params: unknown[]): T[] =>
  db.prepare(sql).all(...(params as never[])) as T[];

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

// Make sure the expected tables exist before querying them.
const tables = new Set(
  all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`).map(
    (r) => r.name,
  ),
);
if (!tables.has('requests') || !tables.has('media_files')) {
  console.error(
    `Database "${dbPath}" doesn't look like an importer DB ` +
      `(missing requests/media_files tables). Has the importer run yet?`,
  );
  process.exit(1);
}

console.log(`Database: ${dbPath}`);

// -- Overview ---------------------------------------------------------------
section('Overview');
const overview = {
  requests_total: one<{ n: number }>(`SELECT COUNT(*) n FROM requests`).n,
  requests_success: one<{ n: number }>(
    `SELECT COUNT(*) n FROM requests WHERE status='success'`,
  ).n,
  requests_error: one<{ n: number }>(
    `SELECT COUNT(*) n FROM requests WHERE status='error'`,
  ).n,
  requests_pending: one<{ n: number }>(
    `SELECT COUNT(*) n FROM requests WHERE status='pending'`,
  ).n,
  media_files_total: one<{ n: number }>(`SELECT COUNT(*) n FROM media_files`).n,
};
console.table(overview);

// -- Media breakdown --------------------------------------------------------
section('Media by kind');
console.table(
  all(`SELECT media_kind, COUNT(*) AS count,
         SUM(COALESCE(size,0)) AS total_bytes
       FROM media_files GROUP BY media_kind ORDER BY count DESC`),
);

section('Media by feed date (top 15)');
console.table(
  all(`SELECT feed_date, COUNT(*) AS media,
         SUM(media_kind='video') AS videos
       FROM media_files
       GROUP BY feed_date ORDER BY feed_date DESC LIMIT 15`),
);

// -- Request history --------------------------------------------------------
section('Recent requests (last 15)');
console.table(
  all(`SELECT id, param_date, next_date, status, attempt_count AS tries,
         http_status AS http, media_file_count AS media, duration_ms AS ms
       FROM requests ORDER BY id DESC LIMIT 15`),
);

const errors = all(
  `SELECT id, param_date, http_status, error_message
     FROM requests WHERE status='error' ORDER BY id DESC LIMIT 10`,
);
if (errors.length > 0) {
  section('Errored requests');
  console.table(errors);
}

// -- Sample media -----------------------------------------------------------
section('Sample media files (5 newest)');
console.table(
  all(`SELECT id, media_kind AS kind, mime_type, feed_date, name, filename
       FROM media_files ORDER BY id DESC LIMIT 5`),
);

// Media that appeared in more than one response (via the join table).
const repeats = all<{ media_file_id: number; seen_in: number }>(
  `SELECT media_file_id, COUNT(*) AS seen_in
     FROM request_media_files GROUP BY media_file_id HAVING seen_in > 1
     ORDER BY seen_in DESC LIMIT 5`,
);
if (repeats.length > 0) {
  section('Media seen in multiple responses (top 5)');
  console.table(repeats);
}

console.log('\nTip: for full browsing, open the same file in DB Browser for SQLite.');
db.close();
