/**
 * Date parsing / normalization helpers.
 *
 * The API query parameter is always `YYYY-MM-DD`. Users may, however, type
 * dates as `DD-MM-YYYY` (e.g. `21-06-2026`). We accept both and always emit
 * the canonical `YYYY-MM-DD` form.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_RE = /^(\d{2})-(\d{2})-(\d{4})$/;

export class InvalidDateError extends Error {
  constructor(input: string) {
    super(
      `Invalid date: "${input}". Expected YYYY-MM-DD (e.g. 2026-06-21) ` +
        `or DD-MM-YYYY (e.g. 21-06-2026).`,
    );
    this.name = 'InvalidDateError';
  }
}

/** Returns true only if y-m-d form a real calendar date. */
export function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Normalize a user- or API-supplied date string to `YYYY-MM-DD`.
 * Accepts `YYYY-MM-DD` and `DD-MM-YYYY`. Throws {@link InvalidDateError}
 * for anything else, including impossible calendar dates (e.g. 2026-02-30).
 */
export function normalizeDate(input: string): string {
  const value = input.trim();

  const iso = ISO_RE.exec(value);
  if (iso) {
    const [, y, m, d] = iso;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (!isValidYmd(year, month, day)) throw new InvalidDateError(input);
    return `${y}-${m}-${d}`;
  }

  const dmy = DMY_RE.exec(value);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (!isValidYmd(year, month, day)) throw new InvalidDateError(input);
    return `${y}-${m}-${d}`;
  }

  throw new InvalidDateError(input);
}

/** Like {@link normalizeDate} but returns null instead of throwing. */
export function tryNormalizeDate(input: string | null | undefined): string | null {
  if (input == null) return null;
  try {
    return normalizeDate(input);
  } catch {
    return null;
  }
}
