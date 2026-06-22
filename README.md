# eliis-media-importer

A small Node.js + TypeScript CLI that crawls the **ELIIS guardian-feed** API,
extracts media records (photos **and** videos), and stores both the request
history and the extracted media metadata in **SQLite**.

It is **pausable and resumable**: each API request is recorded as a row, and the
tool can pick up exactly where it left off (or retry the last failure).

---

## Requirements

- **Node.js ≥ 22.5** (developed and tested on Node 24).
  - Uses the built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) module
    and Node's native TypeScript execution (type-stripping), so there is
    **no build step and no native compilation**.

### Zero runtime dependencies

This project intentionally has **no production dependencies**:

| Need            | Used                                            |
| --------------- | ----------------------------------------------- |
| SQLite          | `node:sqlite` (built in)                         |
| HTTP            | global `fetch` (built in)                        |
| CLI parsing     | `node:util` `parseArgs` (built in)               |
| Hashing         | `node:crypto` (built in)                          |
| Test runner     | `node:test` + `node:assert` (built in)           |
| TS execution    | Node native type-stripping (no `tsx`/`ts-node`)  |

> **Why not `better-sqlite3`?** The task suggested it, but it requires a native
> build (`node-gyp` + Python + a C toolchain). `node:sqlite` ships with Node,
> needs zero compilation, and exposes the same synchronous `prepare/run/get/all`
> API — a strong reason to prefer it here. The data-access layer is isolated in
> [`src/db.ts`](src/db.ts), so swapping back to `better-sqlite3` is a small,
> localized change.

The only (optional) dev dependency is `typescript`, for `npm run typecheck`.

---

## Quick start

```bash
# 1. Configure auth (never commit this file)
cp .env.example .env
#    then edit .env and paste your ELIIS_COOKIE

# 2. Run a crawl starting from a date (DD-MM-YYYY or YYYY-MM-DD both accepted)
npm run start -- --startingDate 21-06-2026

# 3. Later, resume where you left off
npm run start -- --resume
```

### Getting your cookie

The API requires the authenticated session cookie. In your browser DevTools →
Network tab, open a `guardian-feed` request, copy the **`Cookie`** request
header value, and put it in `.env` as `ELIIS_COOKIE`. Treat it like a password.

---

## CLI options

```
--startingDate <date>     Start from this date (YYYY-MM-DD or DD-MM-YYYY).
                          Overrides --resume.
--db <path>               SQLite database path        (default ./eliis.sqlite)
--kindergartenId <id>     Kindergarten id             (or ELIIS_KINDERGARTEN_ID)
--childId <id>            Child id                    (or ELIIS_CHILD_ID)
--maxRequests <number>    Stop after N requests       (default: unlimited)
--dryRun                  Fetch + extract but write nothing to the database
--resume                  Resume from the request table (default when no
                          --startingDate is given)
--recheck-last-success    Re-run the latest successful date (data may change)
--saveRawResponses        Persist raw JSON responses to disk
--rawResponseDir <path>   Where to save raw responses  (default ./raw-responses)
-h, --help                Show help
```

Examples:

```bash
npm run start -- --startingDate 21-06-2026
npm run start -- --db ./eliis.sqlite
npm run start -- --kindergartenId 349 --childId 255561
npm run start -- --maxRequests 10
npm run start -- --dryRun
npm run start -- --resume
npm run start -- --recheck-last-success
```

> Set `LOG_LEVEL=debug` for verbose logging.

---

## How it works

```
GET /api/kindergartens/{kindergartenId}/children/{childId}/guardian-feed?date={YYYY-MM-DD}
```

The response is paginated via a **`next_date`** cursor (the tool also accepts
`nextDate` defensively). The cursor walks **backwards in time**: a request for
`2024-08-30` returns `next_date: "2024-08-23"`, and so on until `next_date` is
`null`, which means the crawl is complete.

For each cursor date the tool:

1. Inserts a `pending` request row.
2. Fetches the page (retrying on failure, see below).
3. Extracts every item under `data[].diaries[].texts[].images[]` — regardless
   of MIME type, since `images[]` includes videos (`video/mp4`) too.
4. Persists the media + marks the request `success` in a single transaction.
5. Follows `next_date` and repeats.

### Media naming

Even though the API field is `images[]`, items may be videos or other media.
They are stored in a table called **`media_files`** with a `mime_type` and a
derived `media_kind` (`image` / `video` / `other`).

---

## Database schema

Created automatically on first run (idempotent migrations in
[`src/migrations.ts`](src/migrations.ts)).

### `requests` — one row per logical request

`id`, `param_date`, `current_date`, `next_date`, `status`
(`pending`/`success`/`error`), `success`, `attempt_count`, `http_status`,
`error_message`, `duration_ms`, `media_file_count`, `raw_response_saved`,
`raw_response_path`, `kindergarten_id`, `child_id`, `response_hash`
(sha256 of the body, for change detection), `started_at`, `finished_at`,
`created_at`.

### `media_files` — one canonical row per media file

`id`, `request_id` (**first**-seen request), `api_media_id`, `mime_type`,
`media_kind`, `url`, `name`, `filename`, `description`, `summary_description`
(plain text, HTML stripped), `summary_html` (raw, optional), `feed_date`
(`data[].date`), `diary_id`, `text_id`, `uploaded_at`, `size`,
`thumbnail_small_url`, `thumbnail_medium_url`, `raw_json`, `created_at`.

### `request_media_files` — join table

Records every `(request_id, media_file_id)` occurrence, so you can tell that the
same media file appeared in multiple API responses even though only one
canonical `media_files` row exists.

### Deduplication

A **unique index on `COALESCE(api_media_id, url)`** keeps one canonical row per
media file: dedup prefers `api_media_id` and falls back to `url`. Inserts use
`INSERT OR IGNORE`; `request_id` on the canonical row is the **first** request
that saw the file, while the join table tracks all later occurrences. Re-running
or resuming therefore never creates duplicate media rows.

---

## Retry & resume

**Retry** (per request): up to **3 attempts** with **exponential backoff**
(≈0.5s, 1s, 2s). Backoff gives a rate-limited/struggling server room to recover.
`attempt_count` is updated on the single logical request row (not one row per
attempt). On final failure the row is marked `status=error`, `success=0`, with
`error_message` and `http_status` (when available), and the crawl stops with
exit code `1`.

**Resume** (decided in [`src/resume.ts`](src/resume.ts)):

1. `--startingDate` given → start there.
2. `--recheck-last-success` → re-run the latest successful `param_date`.
3. Otherwise inspect history:
   - latest row is `error` → **retry that date first**;
   - else latest success has a `next_date` → resume with `date = next_date`;
   - else (no `next_date`) → the crawl is **complete**, nothing to do.

A safety guard stops the crawl if a cursor date is revisited within a run.

---

## Testing

```bash
npm test          # runs node:test over test/*.test.ts
```

Tests are offline and use **fixtures** derived from the real example captures
(see below). Coverage includes: date normalization, HTML stripping, media
extraction (images **and** videos, summaries, thumbnails, `feed_date`),
pagination cursor, retry behavior, the resume decision matrix, and
deduplication (including the `api_media_id` → `url` fallback).

```bash
npm run typecheck # optional; requires `npm i` to install TypeScript
```

---

## Examples & data safety

The `examples/` folder holds raw HTTP captures used to design the importer.
**The original captures contained a real auth cookie (a JWT) and personal data**
(live media URLs, the kindergarten group name, child/parent names, summary
text). A sanitization step handles both:

```bash
npm run sanitize-examples
```

This script ([`scripts/sanitize-examples.ts`](scripts/sanitize-examples.ts)):

1. **Redacts** sensitive request headers (`Cookie`, `Authorization`,
   `Postman-Token`, …) **in place** in `examples/*.txt`.
2. **Scrubs the JSON response body**, replacing personal *values* with
   deterministic synthetic ones — media `url`/`filename`/`name`/`description`
   and all thumbnail URLs, the `course` (group) name, summary `comment` text,
   and `fname`/`lname`/`pp` of users. Structure is preserved (array lengths,
   `mime_type`, every `id`, `next_date`, `date`) so the offline tests still pass.
3. **Emits** the scrubbed JSON bodies into `test/fixtures/*.json`.

The captures and fixtures in this repo have **already been sanitized** — cookies
show as `REDACTED`, media URLs point at `media.example.com`, and no real names
remain — so `examples/` and `test/fixtures/` are safe to commit. The script is
idempotent: re-running it just re-scrubs. `.env`, `*.sqlite`, `raw-responses/`,
and `media/` are git-ignored; cookies are **never** accepted as CLI flags (only
via `ELIIS_COOKIE`) to keep them out of shell history.

---

## Project structure

```
eliis-media-importer/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── examples/                     # sanitized raw API captures
│   └── *-raw.txt
├── scripts/
│   └── sanitize-examples.ts      # redact secrets + emit fixtures
├── src/
│   ├── index.ts                  # entry point / crawl orchestration
│   ├── cli.ts                    # argument parsing
│   ├── config.ts                 # env + CLI + .env merge
│   ├── api.ts                    # fetch client
│   ├── db.ts                     # node:sqlite data access
│   ├── migrations.ts             # schema
│   ├── extractor.ts              # media extraction
│   ├── resume.ts                 # resume decision logic
│   ├── retry.ts                  # exponential-backoff retry
│   ├── types.ts                  # API + DB row types
│   └── utils/
│       ├── dates.ts              # date normalization
│       ├── html.ts               # HTML → plain text
│       └── logging.ts            # leveled logger
└── test/
    ├── fixtures/                 # safe JSON response bodies
    └── *.test.ts
```

---

## Notes for WSL users

If you run a **Windows** Node binary against a project on the **WSL (9p)
filesystem**, SQLite file locking can fail (`database is locked`). Put the
database on a Windows-local path instead, e.g.
`--db C:/Users/you/eliis.sqlite`. Running entirely inside Linux (Linux Node on
the Linux filesystem) or entirely on Windows both work without this caveat.
