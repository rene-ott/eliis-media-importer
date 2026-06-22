import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDate, tryNormalizeDate, InvalidDateError } from '../src/utils/dates.ts';

test('normalizeDate: DD-MM-YYYY becomes YYYY-MM-DD', () => {
  assert.equal(normalizeDate('21-06-2026'), '2026-06-21');
  assert.equal(normalizeDate('01-12-2024'), '2024-12-01');
});

test('normalizeDate: YYYY-MM-DD is unchanged', () => {
  assert.equal(normalizeDate('2026-06-21'), '2026-06-21');
  assert.equal(normalizeDate('2024-08-30'), '2024-08-30');
});

test('normalizeDate: trims surrounding whitespace', () => {
  assert.equal(normalizeDate('  2026-06-21 '), '2026-06-21');
});

test('normalizeDate: invalid input throws InvalidDateError', () => {
  for (const bad of ['', 'nonsense', '2026/06/21', '2026-13-01', '2026-02-30', '32-01-2026', '6-6-2026']) {
    assert.throws(() => normalizeDate(bad), InvalidDateError, `expected throw for "${bad}"`);
  }
});

test('tryNormalizeDate: returns null instead of throwing', () => {
  assert.equal(tryNormalizeDate('21-06-2026'), '2026-06-21');
  assert.equal(tryNormalizeDate('garbage'), null);
  assert.equal(tryNormalizeDate(null), null);
  assert.equal(tryNormalizeDate(undefined), null);
});
