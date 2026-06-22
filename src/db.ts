/**
 * SQLite data-access layer using Node's built-in `node:sqlite` (synchronous).
 *
 * We use `node:sqlite` rather than `better-sqlite3` because the latter requires
 * a native build step (node-gyp + Python + a C toolchain) which isn't always
 * available, whereas `node:sqlite` ships with Node (>= 22.5) and needs zero
 * native compilation. The API is intentionally similar (prepare/run/get/all).
 *
 * All mutating helpers are small and explicit; the multi-row media insert runs
 * inside a single transaction together with the request-success update so a
 * crash can never leave a "success" request with half its media persisted.
 */

import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.ts';
import type { ExtractedMedia, RequestRow, RequestStatus } from './types.ts';

export interface NewRequest {
  param_date: string;
  current_date: string;
  kindergarten_id: string;
  child_id: string;
  started_at: string;
}

export interface RequestSuccessUpdate {
  next_date: string | null;
  http_status: number | null;
  duration_ms: number | null;
  media_file_count: number;
  response_hash: string | null;
  raw_response_saved: boolean;
  raw_response_path: string | null;
  finished_at: string;
}

export interface RequestErrorUpdate {
  http_status: number | null;
  error_message: string;
  duration_ms: number | null;
  finished_at: string;
}

export interface MediaInsertResult {
  inserted: number;
  duplicates: number;
  linked: number;
}

const MEDIA_COLUMNS = [
  'request_id',
  'api_media_id',
  'mime_type',
  'media_kind',
  'url',
  'name',
  'filename',
  'description',
  'summary_description',
  'summary_html',
  'feed_date',
  'diary_id',
  'text_id',
  'uploaded_at',
  'size',
  'thumbnail_small_url',
  'thumbnail_medium_url',
  'raw_json',
] as const;

export class ImporterDb {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    // PRAGMAs (WAL, foreign_keys) are applied inside runMigrations via SCHEMA_SQL.
    runMigrations(this.db);
  }

  close(): void {
    this.db.close();
  }

  // -- requests --------------------------------------------------------------

  /** Insert a `pending` request with attempt_count = 1; returns its id. */
  createPendingRequest(r: NewRequest): number {
    const info = this.db
      .prepare(
        `INSERT INTO requests
           (param_date, "current_date", status, success, attempt_count,
            kindergarten_id, child_id, started_at)
         VALUES (@param_date, @current_date, 'pending', 0, 1,
            @kindergarten_id, @child_id, @started_at)`,
      )
      .run(r);
    return Number(info.lastInsertRowid);
  }

  setAttemptCount(requestId: number, attempt: number): void {
    this.db
      .prepare(`UPDATE requests SET attempt_count = @attempt WHERE id = @id`)
      .run({ attempt, id: requestId });
  }

  markRequestError(requestId: number, attempt: number, u: RequestErrorUpdate): void {
    this.db
      .prepare(
        `UPDATE requests SET
           status = 'error', success = 0, attempt_count = @attempt,
           http_status = @http_status, error_message = @error_message,
           duration_ms = @duration_ms, finished_at = @finished_at
         WHERE id = @id`,
      )
      .run({ ...u, attempt, id: requestId });
  }

  /**
   * Atomically: insert all media (deduped), populate the join table, and mark
   * the request successful with its summary counters. Returns dedup stats.
   */
  finalizeSuccess(
    requestId: number,
    attempt: number,
    media: ExtractedMedia[],
    update: RequestSuccessUpdate,
  ): MediaInsertResult {
    const placeholders = MEDIA_COLUMNS.map((c) => `@${c}`).join(', ');
    const insertMedia = this.db.prepare(
      `INSERT OR IGNORE INTO media_files (${MEDIA_COLUMNS.join(', ')})
       VALUES (${placeholders})`,
    );
    const findByKey = this.db.prepare(
      `SELECT id FROM media_files WHERE COALESCE(api_media_id, url) = ?`,
    );
    const link = this.db.prepare(
      `INSERT OR IGNORE INTO request_media_files (request_id, media_file_id)
       VALUES (?, ?)`,
    );
    const updateRequest = this.db.prepare(
      `UPDATE requests SET
         status = 'success', success = 1, attempt_count = @attempt,
         next_date = @next_date, http_status = @http_status,
         duration_ms = @duration_ms, media_file_count = @media_file_count,
         response_hash = @response_hash, raw_response_saved = @raw_response_saved,
         raw_response_path = @raw_response_path, finished_at = @finished_at
       WHERE id = @id`,
    );

    const runTx = (): MediaInsertResult => {
      const result: MediaInsertResult = { inserted: 0, duplicates: 0, linked: 0 };

      for (const m of media) {
        const params = { request_id: requestId, ...m };
        const info = insertMedia.run(params);

        let mediaId: number | null;
        if (Number(info.changes) === 1) {
          mediaId = Number(info.lastInsertRowid);
          result.inserted++;
        } else {
          // Duplicate ignored — resolve the existing canonical row's id.
          const key = m.api_media_id ?? m.url;
          const existing =
            key != null ? (findByKey.get(key) as { id: number } | undefined) : undefined;
          mediaId = existing ? existing.id : null;
          result.duplicates++;
        }

        if (mediaId != null) {
          const linkInfo = link.run(requestId, mediaId);
          if (Number(linkInfo.changes) === 1) result.linked++;
        }
      }

      updateRequest.run({
        ...update,
        attempt,
        raw_response_saved: update.raw_response_saved ? 1 : 0,
        id: requestId,
      });

      return result;
    };

    this.db.exec('BEGIN');
    try {
      const result = runTx();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // -- resume queries --------------------------------------------------------

  getLatestRequest(): RequestRow | undefined {
    return this.db
      .prepare(`SELECT * FROM requests ORDER BY id DESC LIMIT 1`)
      .get() as RequestRow | undefined;
  }

  getLatestSuccess(): RequestRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM requests WHERE status = 'success'
         ORDER BY id DESC LIMIT 1`,
      )
      .get() as RequestRow | undefined;
  }

  countByStatus(status: RequestStatus): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM requests WHERE status = ?`)
      .get(status) as { n: number };
    return row.n;
  }

  countMediaFiles(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM media_files`).get() as {
      n: number;
    };
    return row.n;
  }
}
