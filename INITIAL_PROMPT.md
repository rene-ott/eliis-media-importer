# Claude Code Planning Prompt: ELIIS Guardian Feed Media Importer

You are Claude Code. Work in planning mode first. Do not implement yet.

I need a Node.js TypeScript command-line tool using SQLite that fetches guardian feed data from an API endpoint, extracts media records from the response, and stores both request history and extracted media metadata.

## Context from sample API responses

Endpoint shape:

```http
GET https://api.eliis.eu/api/kindergartens/{kindergartenId}/children/{childId}/guardian-feed?date={date}
```

Important response details observed in samples:

- The API query parameter is `date`, formatted as `YYYY-MM-DD`.
- User input may provide `startingDate=21-06-2026`, so the tool should normalize `DD-MM-YYYY` input into `YYYY-MM-DD`.
- Response has root `data`, an array of day/feed objects.
- Each `data[]` item has a root-level `date`.
- Each day contains `diaries[]`.
- Each diary may contain `texts[]`.
- Each text may contain:
  - `summaries[]`, each with `comment`
  - `images[]`, each with fields such as:
    - `id`
    - `filename`
    - `name`
    - `description`
    - `mime_type`
    - `size`
    - `uploaded_at`
    - `url`
    - `thumbnails`
- The API response may have a pagination/date cursor field named `next_date`. Also support `nextDate` defensively.
- The next request should use `date = next_date` / `nextDate`.
- Stop when there is no next date, unless a CLI limit says otherwise.

Important naming decision:

- Even though the API property is called `images[]`, it may contain non-image media such as videos.
- Therefore, the application should call these records `media files`.
- Use a database table named `media_files`, not `images`.
- Extract all items from `texts[].images[]`, regardless of MIME type.
- Store `mime_type` so callers can distinguish `image/jpeg`, `video/mp4`, etc.

## Security requirements

- Do not hardcode cookies, auth tokens, or private headers.
- Authentication should be provided via environment variable, for example `ELIIS_COOKIE`, or a config file excluded from git.
- Headers should be configurable but safe by default.
- Do not commit `.env` or any real cookie/token values.
- Add `.env.example` with placeholder values only.

## Required database

Use SQLite.

Propose a schema with at least these tables.

## Table 1: `requests`

Each API request creates exactly one row.

Required fields:

- `id`
- `param_date`: the date sent to the API query parameter
- `current_date`: proposed meaning: the actual cursor/current request date used for this request; normally same as `param_date`
- `next_date`: the next cursor returned by the response
- `status`: enum-like text, for example `pending`, `success`, `error`
- `success`: boolean/integer
- `attempt_count`
- `http_status`
- `error_message`
- `started_at`
- `finished_at`
- `created_at`

Please propose additional useful fields, such as:

- `duration_ms`
- `media_file_count`
- `raw_response_saved`
- `raw_response_path`
- `kindergarten_id`
- `child_id`
- `response_hash`, to detect changed successful responses

## Table 2: `media_files`

Stores extracted media records from `texts[].images[]`.

Required fields:

- `id`
- `request_id`: foreign key to `requests.id`
- `api_media_id`: original id from the API item in `images[]`
- `mime_type`
- `url`
- `name`
- `filename`
- `summary_description`: text derived from nearby `summaries[].comment`
- `feed_date`: the root `data[].date`
- `diary_id`
- `text_id`
- `uploaded_at`
- `size`
- `created_at`

Please propose additional useful fields:

- `description`
- `thumbnail_small_url`
- `thumbnail_medium_url`
- `raw_json`
- `media_kind`, derived from MIME type, for example `image`, `video`, `other`

Clarify whether to preserve raw summary HTML:

- `summary_description` should be plain text with HTML stripped.
- Optionally add `summary_html` if preserving raw HTML is useful.

## Deduplication

Propose a unique constraint to avoid duplicate media rows when a request is retried or resumed.

Candidate strategy:

- Prefer uniqueness by `api_media_id`.
- If `api_media_id` is missing, use `url`.
- If both are present, decide whether `api_media_id` alone is sufficient.
- Explain whether `request_id` should represent:
  - the first request where the media was seen, or
  - each request occurrence.

Preferred approach:

- Store one canonical row per media file in `media_files`.
- Keep `request_id` as the first-seen request id.
- Optionally create a join table, such as `request_media_files`, if it is important to track that the same media appeared in multiple API responses.

## Retry behavior

- If an API request fails, log the error and retry up to 3 times.
- Each retry should update `attempt_count`.
- Decide whether to store one request row per logical request with `attempt_count`, or one row per attempt.
- Prefer one row per logical request unless there is a strong reason otherwise.
- On final failure:
  - set `status = error`
  - set `success = 0`
  - store `error_message`
  - store `http_status` if available
- Use exponential backoff or a simple delay; propose which.

## Resume / pause behavior

Design this carefully because the tool must be pausable and resumable.

Desired behavior:

- On start, if `--startingDate` is provided, start from that date.
- If no `--startingDate` is provided, resume from the request table.
- Find the latest request row by `created_at` or `id`.
- If the latest row has `status = error`, retry that failed `param_date` first.
- Otherwise find the latest successful request row.
- If the latest successful request row has `next_date`, resume with:
  - `currentDate = next_date`
  - API query param `date = next_date`
- If the latest successful row has no `next_date`, treat the crawl as complete.
- Add an optional `--recheck-last-success` flag that intentionally re-runs the latest successful `param_date` to handle data that may have changed.

Important interpretation:

- Each request row should contain:
  - `current_date`: the date requested in this run
  - `next_date`: the cursor returned by the response
- If the process is paused after a successful request, the next run should take the latest successful row’s `next_date` and use that as the new `current_date`.

## CLI requirements

TypeScript Node.js command-line app.

Example command:

```bash
npm run start -- --startingDate 21-06-2026
```

Also support:

```bash
npm run start -- --db ./eliis.sqlite
npm run start -- --kindergartenId 349 --childId 255561
npm run start -- --maxRequests 10
npm run start -- --dryRun
npm run start -- --resume
npm run start -- --recheck-last-success
```

Expected CLI options:

- `--startingDate <date>`
- `--db <path>`
- `--kindergartenId <id>`
- `--childId <id>`
- `--maxRequests <number>`
- `--dryRun`
- `--resume`
- `--recheck-last-success`
- `--saveRawResponses`
- `--rawResponseDir <path>`

## Implementation preferences

- Use Node.js with TypeScript.
- Use `tsx` for running TypeScript in development.
- Recommend a SQLite library. Prefer `better-sqlite3` unless there is a strong reason to choose another.
- Use native `fetch` if the selected Node version supports it; otherwise propose `undici`.
- Use a migration/init step to create tables.
- Use transactions when inserting a successful request and related media files.
- Store raw JSON optionally if useful for debugging.
- Strip HTML tags from `summaries[].comment` for `summary_description`.
- If multiple summaries exist for one text, combine them by stripping HTML from each and joining with two newlines.
- If a media file belongs to a text with summaries, attach that text’s combined summaries to the media row.
- If there are media files but no summaries, store null or an empty summary description.
- Validate and normalize dates.
- Log progress clearly:
  - requested date
  - HTTP status
  - next date
  - media files extracted
  - retries
  - completion reason


## Example requests folder

The project should include an `examples/` folder containing the provided raw example API request/response captures. Claude Code should inspect these examples during planning to infer the response shape, pagination behavior, media file fields, summary/comment structure, and date cursor behavior.

Example structure:

```text
examples/
  2024-08-16-raw.txt
  2024-08-23-raw.txt
  2024-08-30-raw.txt
  2024-09-06-raw.txt
  2026-06-21-raw.txt
```

Important:

- Treat these files as examples only.
- Do not commit real cookies, tokens, or private authorization headers.
- If the raw files contain cookies or private headers, propose a sanitization step or keep sanitized versions only.
- Use the example files for tests/fixtures where possible, after stripping request headers and keeping only safe JSON response bodies.

## Proposed project structure

Please propose something like:

```text
eliis-media-importer/
  package.json
  tsconfig.json
  .env.example
  README.md
  examples/
    2024-08-16-raw.txt
    2024-08-23-raw.txt
    2024-08-30-raw.txt
    2024-09-06-raw.txt
    2026-06-21-raw.txt
  src/
    index.ts
    cli.ts
    config.ts
    api.ts
    db.ts
    migrations.ts
    extractor.ts
    resume.ts
    retry.ts
    types.ts
    utils/
      dates.ts
      html.ts
      logging.ts
  test/
    fixtures/
      guardian-feed-2024-08-30.json
      guardian-feed-2024-09-06.json
    extractor.test.ts
    resume.test.ts
```

## Proposed TypeScript types

Please propose TypeScript interfaces for the API response, including:

- `GuardianFeedResponse`
- `FeedDay`
- `Diary`
- `DiaryText`
- `Summary`
- `ApiMediaFile`
- `Thumbnail`
- `RequestRow`
- `MediaFileRow`

Use optional fields where the API may omit data.

## Testing plan

Use fixture JSON files from saved API responses.

Test:

1. Date normalization:
   - `21-06-2026` becomes `2026-06-21`
   - `2026-06-21` remains `2026-06-21`
   - invalid dates fail clearly

2. Extraction:
   - extracts all `texts[].images[]`
   - includes both `image/*` and `video/*`
   - stores `mime_type`, `url`, `name`, `filename`
   - attaches root `data[].date` as `feed_date`
   - attaches combined nearby summary text

3. Pagination:
   - next request uses `next_date`
   - stops when `next_date` is null or missing

4. Retry:
   - retries failures up to 3 times
   - final failed request has `status = error`

5. Resume:
   - resumes from latest successful `next_date`
   - retries latest error row first
   - handles completed crawl when latest success has no `next_date`

6. Deduplication:
   - repeated successful request does not duplicate media rows

## Deliverables for planning response

Please produce:

1. Concise implementation plan.
2. Proposed project structure.
3. Proposed SQLite schema.
4. Proposed TypeScript types for the API response and DB rows.
5. Proposed CLI behavior.
6. Detailed resume algorithm.
7. Retry/error handling plan.
8. Deduplication strategy.
9. Testing plan.
10. How the `examples/` folder should be used safely during planning and testing.
11. Any clarifying questions or assumptions.

Do not write the full implementation yet. First propose the plan and wait for approval.
