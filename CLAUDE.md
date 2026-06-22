# CLAUDE.md

Guidance for future Claude Code sessions working in this repo.

## What this is

`eliis-media-importer` — a CLI that crawls the **ELIIS guardian-feed API**,
stores request history + media metadata in **SQLite**, and (via a script) can
download the actual photo/video binaries. See `README.md` for the user-facing
docs; this file captures the non-obvious things.

## ⚠️ Critical environment facts (read first)

This repo lives on the **WSL (Debian) filesystem** but the only available
**Node is a Windows binary** (`node.exe`, v24.x). This combination has sharp
edges — most "weird" failures trace back to it:

- **`node` is NOT on the WSL PATH.** Use the full path:
  ```
  /mnt/c/Users/Rene/scoop/apps/nvm/current/nodejs/nodejs/node.exe
  ```
  (Suggest the user add an alias: `alias enode='<that path> --disable-warning=ExperimentalWarning'`.)
- **`npm install` does NOT work** from the WSL path — Windows npm gets a UNC cwd
  (`\\wsl.localhost\...`) and breaks. So this project is **zero-dependency by
  design** (see below). Do not add npm dependencies expecting `npm install` to work.
- **SQLite locking fails on the WSL 9p mount** when accessed by Windows node
  (`database is locked`). **Keep the `.sqlite` DB on a Windows path**, e.g.
  `--db "C:/Users/Rene/eliis-media.sqlite"`. Reading/writing plain files on the
  WSL path is fine — only SQLite locking is affected. (`--dryRun` sidesteps this
  by using an in-memory DB.)
- **Shell env vars do NOT cross the WSL→Windows boundary.** `ELIIS_COOKIE=… node.exe`
  arrives as `undefined`. Configuration must come from the **`.env` file** (read
  as a file, so it works) or CLI flags — not exported env vars.
- Always pass `--disable-warning=ExperimentalWarning` to silence the
  `node:sqlite` experimental notice.

## Zero-dependency design

No runtime deps. Everything uses Node built-ins:

| Need        | Used                                |
| ----------- | ----------------------------------- |
| SQLite      | `node:sqlite` (`DatabaseSync`)      |
| HTTP        | global `fetch`                       |
| CLI parsing | `node:util` `parseArgs`              |
| Hashing     | `node:crypto`                        |
| Tests       | `node:test` + `node:assert`          |
| TS runtime  | Node native type-stripping (no tsx) |

- **`better-sqlite3` was rejected**: it needs a native build (node-gyp + Python),
  which fails here. `node:sqlite` is built in and has the same sync API. The DB
  layer is isolated in `src/db.ts` if this ever needs revisiting.
- **`node:sqlite` differs from better-sqlite3**: no `db.pragma()` (use `exec`),
  no `db.transaction()` helper (use manual `BEGIN`/`COMMIT`/`ROLLBACK` — see
  `finalizeSuccess`), and `run().changes` may be a bigint (wrap in `Number()`).
- The only devDependency is `typescript`, for the optional `npm run typecheck`
  (which itself needs `npm install` and so generally isn't run in this env).

## Conventions

- **Relative imports use explicit `.ts` extensions** (e.g. `./db.ts`), because
  Node's native TS execution does NOT rewrite `.js`→`.ts`. `tsconfig.json` sets
  `allowImportingTsExtensions` + `noEmit` to match. Don't "fix" these to `.js`.
- ESM throughout (`"type": "module"`).
- Logger writes to **stderr**; stdout is kept clean.

## Commands

Run via `node.exe` directly (npm scripts mirror these but `npm run` is unreliable
from the WSL path):

```bash
N="/mnt/c/Users/Rene/scoop/apps/nvm/current/nodejs/nodejs/node.exe --disable-warning=ExperimentalWarning"

$N --test test/*.test.ts                       # tests (35, all built-in)
$N src/index.ts --startingDate 22-06-2026 --db "C:/Users/Rene/eliis-media.sqlite"
$N src/index.ts --resume --db "C:/..."         # resume a crawl
$N scripts/inspect.ts "C:/Users/Rene/eliis-media.sqlite"
$N scripts/download-media.ts --db "C:/..." --out ./media --delay 300
$N scripts/sanitize-examples.ts                # redact cookies + regen fixtures
```

## Layout

```
src/
  index.ts       crawl orchestration (entry point)
  cli.ts         parseArgs-based CLI
  config.ts      env + .env + CLI merge; .env loader; safe default headers
  api.ts         fetch client (ApiError, response hashing)
  db.ts          node:sqlite data access (ImporterDb)
  migrations.ts  schema (SCHEMA_SQL)
  extractor.ts   data[].diaries[].texts[].images[] -> media rows
  resume.ts      pure decideStart() resume logic
  retry.ts       withRetry() exponential backoff
  types.ts       API + DB row types
  utils/{dates,html,logging}.ts
scripts/
  inspect.ts          read-only DB summary (console.table)
  download-media.ts   download binaries -> media/{images,videos,other}/
  sanitize-examples.ts redact secrets in examples/, emit test/fixtures/
test/                 node:test specs + fixtures/ (safe JSON bodies)
examples/             sanitized raw HTTP captures (cookies REDACTED)
```

## Domain notes

- API path: `/api/kindergartens/{kgId}/children/{childId}/guardian-feed?date=YYYY-MM-DD`.
  Dates also accept `DD-MM-YYYY` input (normalized in `utils/dates.ts`).
- **Pagination cursor walks backward in time** via `next_date` (fallback
  `nextDate`); `null` means the crawl is complete.
- `images[]` includes **videos** (`video/mp4`) — stored in table `media_files`
  with a derived `media_kind` (image/video/other). Don't assume image-only.
- **Dedup**: unique index on `COALESCE(api_media_id, url)`; canonical row keeps
  the first-seen `request_id`; `request_media_files` join table records every
  occurrence. Re-runs never duplicate rows.
- **Retry**: 3 attempts, exponential backoff, one row per logical request
  (`attempt_count` increments). Final failure → `status='error'`, exit 1.

## Tables

- `requests` — one row per logical request (param_date, current_date, next_date,
  status, attempt_count, http_status, duration_ms, media_file_count,
  response_hash, …). Note `current_date` is quoted in SQL (collides with the
  `CURRENT_DATE` keyword).
- `media_files` — canonical media rows (api_media_id, mime_type, media_kind, url,
  name, filename, summary_description [HTML-stripped], summary_html, feed_date,
  diary_id, text_id, size, thumbnail_*_url, raw_json, …).
- `request_media_files` — (request_id, media_file_id) occurrences.

## Security / data handling

- `.env` (real cookie), `*.sqlite`, `raw-responses/`, `media/`, and
  `examples/` are **git-ignored**. `examples/` is kept local because the
  sanitized captures still contain public child data and live image links — do
  not commit it. The example captures originally contained a real auth JWT in
  the `Cookie` header — `sanitize-examples.ts` redacted them in place
  (now `REDACTED`). Never commit cookies/tokens. Cookies come only from
  `ELIIS_COOKIE`, never CLI flags.
- Note: `test/fixtures/*.json` are derived from `examples/` and ARE committed
  (tests need them). They carry the same image URLs — scrub/regenerate via
  `sanitize-examples.ts` if that ever becomes a concern.

## Known gotcha

- `download-media.ts` names files `{feed_date}-{name}.{ext}`. Distinct media with
  an identical date+name **collide** (one overwrites/skips the other). The full
  6,247-item download hit **12** such collisions. Use `--unique` to append
  `api_media_id` and guarantee distinct names. (Recovery for an already-collided
  run: download just the colliding rows' "extras" with the id suffix.)
