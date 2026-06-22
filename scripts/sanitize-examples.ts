/**
 * Sanitize the raw API captures in `examples/` and emit safe JSON fixtures.
 *
 * The raw `.txt` files are full HTTP request/response captures that contain
 * sensitive request headers (notably `Cookie`, which holds the auth JWT, plus
 * `Postman-Token`) AND a JSON response body with personal data (live media
 * URLs, the kindergarten group/`course` name, child/parent names, summary
 * text). This script:
 *
 *   1. Rewrites each examples/*.txt IN PLACE, redacting sensitive headers and
 *      scrubbing the JSON body, so the capture can be committed without leaking
 *      secrets or personal data.
 *   2. Extracts the SCRUBBED JSON response body into test/fixtures/*.json for
 *      use as offline test fixtures.
 *
 * Scrubbing is structure-preserving: array lengths, `mime_type`, `id`s,
 * `next_date`, and `date` are kept so the extractor/DB tests still pass; only
 * personal *values* are replaced with deterministic synthetic ones.
 *
 * Run with: npm run sanitize-examples
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

const EXAMPLES_DIR = join(process.cwd(), 'examples');
const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures');

// Request headers whose VALUES must never be kept. Matched case-insensitively
// at the start of a header line ("Header: value").
const SENSITIVE_HEADERS = [
  'cookie',
  'authorization',
  'postman-token',
  'x-api-key',
  'set-cookie',
];

const REDACTION = 'REDACTED';

function redactHeaders(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon <= 0) return line;
      const name = line.slice(0, colon).trim().toLowerCase();
      if (SENSITIVE_HEADERS.includes(name)) {
        return `${line.slice(0, colon)}: ${REDACTION}`;
      }
      return line;
    })
    .join('\n');
}

/** Locate the JSON response body: the first `{` that parses to the end. */
function findJsonBody(raw: string): { index: number; value: unknown } | null {
  for (let i = raw.indexOf('{'); i !== -1; i = raw.indexOf('{', i + 1)) {
    try {
      return { index: i, value: JSON.parse(raw.slice(i)) };
    } catch {
      // keep scanning
    }
  }
  return null;
}

/** Short deterministic hash, so the same original always maps to the same
 *  synthetic value (stable diffs, no accidental dedup collisions). */
function hash(input: unknown): string {
  return createHash('sha1').update(String(input)).digest('hex').slice(0, 16);
}

/** Preserve a file extension (`.jpg`, `.mp4`, …) so MIME-derived logic holds. */
function ext(name: unknown): string {
  const m = /\.[a-z0-9]+$/i.exec(String(name ?? ''));
  return m ? m[0].toLowerCase() : '';
}

/**
 * Replace personal *values* in the response body in place, keeping structure
 * intact. Image nodes are identified by a `mime_type` field so that generic
 * keys like `name` are only scrubbed there (the diary `status.name`, an
 * attendance label, is left alone).
 */
function scrubBody(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) scrubBody(item);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  const isImage = typeof obj.mime_type === 'string';

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v !== null && typeof v === 'object') {
      scrubBody(v);
      continue;
    }
    if (v == null) continue;

    switch (key) {
      case 'course': // kindergarten group name
        obj[key] = 'Example Group';
        break;
      case 'fname':
        obj[key] = 'Example';
        break;
      case 'lname':
        obj[key] = 'Member';
        break;
      case 'pp': // profile picture URL
        obj[key] = `https://media.example.com/avatar/${hash(v)}.jpg`;
        break;
      case 'comment': // summary HTML — keep tags so HTML-stripping is exercised
        obj[key] =
          '<p>Example summary text.</p><p><br></p><p>Sample activity description.</p>';
        break;
      case 'url': // image + thumbnail media links
        obj[key] = `https://media.example.com/${hash(v)}${ext(v)}`;
        break;
      case 'filename': // image + thumbnail filenames
        obj[key] = `${hash(v)}${ext(v)}`;
        break;
      case 'name':
        // Image media name, or the diary `status.name` attendance label.
        // Neither is needed verbatim.
        obj[key] = isImage ? `media-${hash(v)}` : 'Example';
        break;
      case 'description':
        if (isImage) obj[key] = 'Example media description';
        break;
      default:
        break;
    }
  }
}

function fixtureNameFor(file: string): string {
  // 2024-08-30-raw.txt -> guardian-feed-2024-08-30.json
  const date = basename(file).replace(/-raw\.txt$/i, '');
  return `guardian-feed-${date}.json`;
}

function main(): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });

  const files = readdirSync(EXAMPLES_DIR).filter((f) => /-raw\.txt$/i.test(f));
  if (files.length === 0) {
    console.error(`No *-raw.txt files found in ${EXAMPLES_DIR}`);
    process.exitCode = 1;
    return;
  }

  for (const file of files) {
    const srcPath = join(EXAMPLES_DIR, file);
    const raw = readFileSync(srcPath, 'utf8');

    // 1. Redact sensitive request headers.
    const redacted = redactHeaders(raw);

    // 2. Locate + scrub the JSON response body (personal data).
    const found = findJsonBody(redacted);
    if (found == null) {
      console.warn(`! Could not extract JSON body from examples/${file}`);
      // Still persist any header redaction we managed.
      if (redacted !== raw) writeFileSync(srcPath, redacted, 'utf8');
      continue;
    }
    scrubBody(found.value);

    // 3. Rewrite the capture in place: untouched header section + scrubbed body.
    const newRaw = `${redacted.slice(0, found.index)}${JSON.stringify(found.value)}\n`;
    if (newRaw !== raw) {
      writeFileSync(srcPath, newRaw, 'utf8');
      console.log(`Sanitized examples/${file} (headers + body)`);
    }

    // 4. Emit the scrubbed JSON fixture.
    const fixturePath = join(FIXTURES_DIR, fixtureNameFor(file));
    writeFileSync(fixturePath, `${JSON.stringify(found.value, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${fixturePath}`);
  }

  console.log('\nDone. Examples + fixtures are scrubbed and safe to commit.');
}

main();
