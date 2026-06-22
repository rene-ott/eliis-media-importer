import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideStart } from '../src/resume.ts';
import type { RequestRow } from '../src/types.ts';

function row(partial: Partial<RequestRow>): RequestRow {
  return {
    id: 1,
    param_date: '2024-08-30',
    current_date: '2024-08-30',
    next_date: null,
    status: 'success',
    success: 1,
    attempt_count: 1,
    http_status: 200,
    error_message: null,
    duration_ms: 10,
    media_file_count: 0,
    raw_response_saved: 0,
    raw_response_path: null,
    kindergarten_id: '349',
    child_id: '255561',
    response_hash: null,
    started_at: null,
    finished_at: null,
    created_at: '2024-08-30T00:00:00Z',
    ...partial,
  };
}

test('explicit startingDate always wins', () => {
  const d = decideStart({
    startingDate: '2026-06-21',
    recheckLastSuccess: false,
    latestRequest: row({ status: 'error' }),
    latestSuccess: row({ next_date: '2024-08-23' }),
  });
  assert.deepEqual(d, { action: 'start', date: '2026-06-21', reason: d.action === 'start' ? d.reason : '' });
  assert.equal(d.action === 'start' && d.date, '2026-06-21');
});

test('resume from latest success next_date', () => {
  const d = decideStart({
    recheckLastSuccess: false,
    latestRequest: row({ id: 5, status: 'success', next_date: '2024-08-23' }),
    latestSuccess: row({ id: 5, status: 'success', next_date: '2024-08-23' }),
  });
  assert.equal(d.action, 'start');
  assert.equal(d.action === 'start' && d.date, '2024-08-23');
});

test('latest error row is retried first (before resuming success)', () => {
  const d = decideStart({
    recheckLastSuccess: false,
    latestRequest: row({ id: 6, status: 'error', param_date: '2024-08-16' }),
    latestSuccess: row({ id: 5, status: 'success', next_date: '2024-08-16' }),
  });
  assert.equal(d.action, 'start');
  assert.equal(d.action === 'start' && d.date, '2024-08-16');
  assert.match(d.action === 'start' ? d.reason : '', /errored/);
});

test('completed crawl: latest success has no next_date', () => {
  const d = decideStart({
    recheckLastSuccess: false,
    latestRequest: row({ id: 5, status: 'success', next_date: null }),
    latestSuccess: row({ id: 5, status: 'success', next_date: null }),
  });
  assert.equal(d.action, 'complete');
});

test('empty history without startingDate -> complete with guidance', () => {
  const d = decideStart({ recheckLastSuccess: false });
  assert.equal(d.action, 'complete');
  assert.match(d.reason, /startingDate/);
});

test('recheck-last-success re-runs the latest successful param_date', () => {
  const d = decideStart({
    recheckLastSuccess: true,
    latestRequest: row({ id: 5, status: 'success', param_date: '2024-08-30', next_date: '2024-08-23' }),
    latestSuccess: row({ id: 5, status: 'success', param_date: '2024-08-30', next_date: '2024-08-23' }),
  });
  assert.equal(d.action, 'start');
  assert.equal(d.action === 'start' && d.date, '2024-08-30');
});

test('pending/interrupted latest with no success is re-run', () => {
  const d = decideStart({
    recheckLastSuccess: false,
    latestRequest: row({ id: 1, status: 'pending', param_date: '2024-09-06' }),
    latestSuccess: undefined,
  });
  assert.equal(d.action, 'start');
  assert.equal(d.action === 'start' && d.date, '2024-09-06');
});
