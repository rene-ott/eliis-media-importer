import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ImporterDb } from '../src/db.ts';
import { extractMedia } from '../src/extractor.ts';
import type { GuardianFeedResponse } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
function loadFixture(name: string): GuardianFeedResponse {
  return JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));
}

function freshDb(): ImporterDb {
  return new ImporterDb(':memory:');
}

function successUpdate(over: Partial<Parameters<ImporterDb['finalizeSuccess']>[3]> = {}) {
  return {
    next_date: '2024-08-23',
    http_status: 200,
    duration_ms: 5,
    media_file_count: 0,
    response_hash: 'hash',
    raw_response_saved: false,
    raw_response_path: null,
    finished_at: '2024-08-30T00:00:00Z',
    ...over,
  };
}

test('createPendingRequest + finalizeSuccess persists media and request row', () => {
  const db = freshDb();
  const media = extractMedia(loadFixture('guardian-feed-2024-08-30'));
  const id = db.createPendingRequest({
    param_date: '2024-08-30',
    current_date: '2024-08-30',
    kindergarten_id: '349',
    child_id: '255561',
    started_at: '2024-08-30T00:00:00Z',
  });
  const res = db.finalizeSuccess(id, 1, media, successUpdate({ media_file_count: media.length }));

  assert.equal(res.inserted, media.length);
  assert.equal(res.duplicates, 0);
  assert.equal(db.countMediaFiles(), media.length);

  const latest = db.getLatestSuccess();
  assert.ok(latest);
  assert.equal(latest!.status, 'success');
  assert.equal(latest!.success, 1);
  assert.equal(latest!.next_date, '2024-08-23');
  assert.equal(latest!.media_file_count, media.length);
  db.close();
});

test('deduplication: re-running the same request does not duplicate media rows', () => {
  const db = freshDb();
  const media = extractMedia(loadFixture('guardian-feed-2024-08-30'));

  const id1 = db.createPendingRequest({
    param_date: '2024-08-30', current_date: '2024-08-30',
    kindergarten_id: '349', child_id: '255561', started_at: 't1',
  });
  const r1 = db.finalizeSuccess(id1, 1, media, successUpdate({ media_file_count: media.length }));
  assert.equal(r1.inserted, media.length);

  // Same response processed again as a new request (resume / recheck scenario).
  const id2 = db.createPendingRequest({
    param_date: '2024-08-30', current_date: '2024-08-30',
    kindergarten_id: '349', child_id: '255561', started_at: 't2',
  });
  const r2 = db.finalizeSuccess(id2, 1, media, successUpdate({ media_file_count: media.length }));

  assert.equal(r2.inserted, 0, 'no new canonical rows on repeat');
  assert.equal(r2.duplicates, media.length);
  assert.equal(db.countMediaFiles(), media.length, 'media table count unchanged');

  // Join table records BOTH occurrences for each media file.
  const rmfCount = db.db.prepare('SELECT COUNT(*) AS n FROM request_media_files').get() as { n: number };
  assert.equal(rmfCount.n, media.length * 2);

  // Canonical row keeps the FIRST-seen request id.
  const sample = db.db.prepare('SELECT request_id FROM media_files LIMIT 1').get() as { request_id: number };
  assert.equal(sample.request_id, id1);
  db.close();
});

test('markRequestError records error status and is found by getLatestRequest', () => {
  const db = freshDb();
  const id = db.createPendingRequest({
    param_date: '2024-08-09', current_date: '2024-08-09',
    kindergarten_id: '349', child_id: '255561', started_at: 't',
  });
  db.markRequestError(id, 3, {
    http_status: 500,
    error_message: 'HTTP 500 Internal Server Error',
    duration_ms: 12,
    finished_at: 'tt',
  });
  const latest = db.getLatestRequest();
  assert.equal(latest!.status, 'error');
  assert.equal(latest!.success, 0);
  assert.equal(latest!.attempt_count, 3);
  assert.equal(latest!.http_status, 500);
  assert.equal(db.countByStatus('error'), 1);
  assert.equal(db.getLatestSuccess(), undefined);
  db.close();
});

test('dedup falls back to url when api_media_id is missing', () => {
  const db = freshDb();
  const id = db.createPendingRequest({
    param_date: 'd', current_date: 'd', kindergarten_id: '1', child_id: '2', started_at: 't',
  });
  const base = {
    api_media_id: null, mime_type: 'image/jpeg', media_kind: 'image' as const,
    url: 'https://x/y.jpg', name: null, filename: null, description: null,
    summary_description: null, summary_html: null, feed_date: '2024-01-01',
    diary_id: null, text_id: null, uploaded_at: null, size: null,
    thumbnail_small_url: null, thumbnail_medium_url: null, raw_json: '{}',
  };
  const res = db.finalizeSuccess(id, 1, [base, { ...base }], successUpdate());
  assert.equal(res.inserted, 1, 'same url deduped to a single row');
  assert.equal(res.duplicates, 1);
  db.close();
});
