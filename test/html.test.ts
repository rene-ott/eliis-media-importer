import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, combineSummariesPlain, combineSummariesHtml } from '../src/utils/html.ts';

test('stripHtml: removes tags and decodes entities', () => {
  assert.equal(stripHtml('<p>Hello &amp; welcome</p>'), 'Hello & welcome');
  assert.equal(stripHtml('a&nbsp;b'), 'a b');
  assert.equal(stripHtml('<p>x &#8230;</p>'), 'x …');
});

test('stripHtml: paragraph boundaries become newlines, whitespace collapses', () => {
  assert.equal(stripHtml('<p>One</p><p>Two</p>'), 'One\nTwo');
  assert.equal(stripHtml('a<br>b'), 'a\nb');
  assert.equal(stripHtml('<p>  lots   of   space </p>'), 'lots of space');
});

test('stripHtml: empty/nullish input yields empty string', () => {
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
});

test('combineSummariesPlain: joins multiple summaries with blank line', () => {
  const out = combineSummariesPlain([
    { comment: '<p>First</p>' },
    { comment: '<p>Second</p>' },
  ]);
  assert.equal(out, 'First\n\nSecond');
});

test('combineSummariesPlain: skips empty comments, returns null when nothing usable', () => {
  assert.equal(combineSummariesPlain([{ comment: '' }, { comment: null }]), null);
  assert.equal(combineSummariesPlain([]), null);
  assert.equal(combineSummariesPlain(undefined), null);
  assert.equal(combineSummariesPlain([{ comment: '<p>X</p>' }, { comment: '' }]), 'X');
});

test('combineSummariesHtml: preserves raw HTML joined with blank line', () => {
  const out = combineSummariesHtml([{ comment: '<p>A</p>' }, { comment: '<p>B</p>' }]);
  assert.equal(out, '<p>A</p>\n\n<p>B</p>');
  assert.equal(combineSummariesHtml(undefined), null);
});
