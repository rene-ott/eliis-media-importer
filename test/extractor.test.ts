import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractMedia, getNextDate, mediaKindFromMime } from '../src/extractor.ts';
import type { GuardianFeedResponse } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): GuardianFeedResponse {
  const path = join(here, 'fixtures', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as GuardianFeedResponse;
}

test('mediaKindFromMime: classifies image/video/other', () => {
  assert.equal(mediaKindFromMime('image/jpeg'), 'image');
  assert.equal(mediaKindFromMime('video/mp4'), 'video');
  assert.equal(mediaKindFromMime('application/pdf'), 'other');
  assert.equal(mediaKindFromMime(null), 'other');
});

test('extractMedia: extracts every texts[].images[] item from a real response', () => {
  const media = extractMedia(loadFixture('guardian-feed-2024-08-30'));
  // The raw capture contains 31 mime_type occurrences == 31 media items.
  assert.equal(media.length, 31);
});

test('extractMedia: includes both images and videos, storing core fields', () => {
  const media = extractMedia(loadFixture('guardian-feed-2024-09-06'));
  assert.equal(media.length, 87);

  const images = media.filter((m) => m.media_kind === 'image');
  const videos = media.filter((m) => m.media_kind === 'video');
  assert.ok(images.length > 0, 'expected at least one image');
  assert.ok(videos.length > 0, 'expected at least one video (video/mp4)');

  const sample = media[0]!;
  assert.equal(typeof sample.mime_type, 'string');
  assert.equal(typeof sample.url, 'string');
  assert.equal(typeof sample.filename, 'string');
  assert.equal(typeof sample.name, 'string');
  // size is coerced from the API's string into a number
  assert.ok(sample.size === null || typeof sample.size === 'number');
});

test('extractMedia: attaches root data[].date as feed_date and links diary/text ids', () => {
  const media = extractMedia(loadFixture('guardian-feed-2024-08-30'));
  for (const m of media) {
    assert.match(m.feed_date ?? '', /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof m.diary_id, 'number');
    assert.equal(typeof m.text_id, 'number');
    assert.equal(typeof m.api_media_id, 'string');
  }
});

test('extractMedia: attaches combined nearby summary text (HTML stripped)', () => {
  const media = extractMedia(loadFixture('guardian-feed-2024-08-30'));
  const withSummary = media.find((m) => m.summary_description);
  assert.ok(withSummary, 'expected at least one media item with a summary');
  // Plain text: no HTML tags should remain.
  assert.doesNotMatch(withSummary!.summary_description!, /<[^>]+>/);
});

test('extractMedia: thumbnails small/medium urls captured when present', () => {
  const media = extractMedia(loadFixture('guardian-feed-2024-08-30'));
  const withThumb = media.find((m) => m.thumbnail_small_url || m.thumbnail_medium_url);
  assert.ok(withThumb, 'expected at least one media item with thumbnails');
  if (withThumb!.thumbnail_small_url) {
    assert.match(withThumb!.thumbnail_small_url, /^https?:\/\//);
  }
});

test('extractMedia: day with no media yields no rows', () => {
  const media = extractMedia(loadFixture('guardian-feed-2024-08-23'));
  assert.equal(media.length, 0);
});

test('getNextDate: reads next_date cursor, returns null when absent', () => {
  assert.equal(getNextDate(loadFixture('guardian-feed-2024-08-30')), '2024-08-23');
  assert.equal(getNextDate(loadFixture('guardian-feed-2024-08-23')), '2024-08-16');
  // 2024-08-16 fixture has "next_date": null -> crawl complete.
  assert.equal(getNextDate(loadFixture('guardian-feed-2024-08-16')), null);
});

test('getNextDate: defensively supports camelCase nextDate', () => {
  const resp = { data: [], nextDate: '2024-01-01' } as GuardianFeedResponse;
  assert.equal(getNextDate(resp), '2024-01-01');
});
