/**
 * Minimal HTML -> plain text conversion for summary comments.
 *
 * Summaries arrive as small HTML fragments (`<p>...</p>`). We strip tags,
 * decode the handful of entities that actually appear, and normalize
 * whitespace so the stored `summary_description` is clean plain text.
 */

import type { Summary } from '../types.ts';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const codePoint =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isFinite(codePoint) && codePoint > 0) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/**
 * Strip HTML tags and return clean plain text. Block-level boundaries
 * (`</p>`, `<br>`, `</div>`, `</li>`) become newlines so paragraph structure
 * survives; runs of whitespace are collapsed.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';

  const withBreaks = html
    .replace(/<\s*(br|hr)\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, '\n');

  const withoutTags = withBreaks.replace(/<[^>]+>/g, '');
  const decoded = decodeEntities(withoutTags);

  return decoded
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

/**
 * Combine a text's summaries into a single plain-text block: each comment is
 * HTML-stripped and the results are joined with a blank line. Returns null if
 * there is no usable summary text.
 */
export function combineSummariesPlain(summaries: Summary[] | undefined): string | null {
  if (!summaries || summaries.length === 0) return null;
  const parts = summaries
    .map((s) => stripHtml(s.comment))
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * Combine the raw HTML of a text's summaries, joined with a blank line.
 * Returns null if there is no HTML to preserve.
 */
export function combineSummariesHtml(summaries: Summary[] | undefined): string | null {
  if (!summaries || summaries.length === 0) return null;
  const parts = summaries
    .map((s) => (s.comment ?? '').trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join('\n\n') : null;
}
