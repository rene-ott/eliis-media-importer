/**
 * CLI argument parsing using the built-in `node:util` parseArgs (no deps).
 */

import { parseArgs } from 'node:util';
import { normalizeDate } from './utils/dates.ts';

export interface CliOptions {
  startingDate?: string; // normalized YYYY-MM-DD
  db?: string;
  kindergartenId?: string;
  childId?: string;
  maxRequests?: number;
  dryRun: boolean;
  resume: boolean;
  recheckLastSuccess: boolean;
  saveRawResponses: boolean;
  rawResponseDir?: string;
  help: boolean;
}

export const HELP_TEXT = `
eliis-media-importer — fetch ELIIS guardian-feed media into SQLite

Usage:
  npm run start -- [options]

Options:
  --startingDate <date>     Start from this date. Accepts YYYY-MM-DD or
                            DD-MM-YYYY (e.g. 21-06-2026). Overrides --resume.
  --db <path>               SQLite database path        (default ./eliis.sqlite)
  --kindergartenId <id>     Kindergarten id             (or ELIIS_KINDERGARTEN_ID)
  --childId <id>            Child id                    (or ELIIS_CHILD_ID)
  --maxRequests <number>    Stop after N requests       (default: unlimited)
  --dryRun                  Fetch + extract but write nothing to the database
  --resume                  Resume from the request table (default when no
                            --startingDate is given)
  --recheck-last-success    Re-run the latest successful date (data may change)
  --saveRawResponses        Persist raw JSON responses to disk
  --rawResponseDir <path>   Where to save raw responses  (default ./raw-responses)
  -h, --help                Show this help

Auth:
  Set ELIIS_COOKIE in the environment or a .env file (see .env.example).
  Cookies are never accepted as CLI flags.
`;

export class CliError extends Error {}

function toPositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError(`${flag} must be a positive integer, got "${value}".`);
  }
  return n;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        startingDate: { type: 'string' },
        db: { type: 'string' },
        kindergartenId: { type: 'string' },
        childId: { type: 'string' },
        maxRequests: { type: 'string' },
        dryRun: { type: 'boolean', default: false },
        resume: { type: 'boolean', default: false },
        'recheck-last-success': { type: 'boolean', default: false },
        saveRawResponses: { type: 'boolean', default: false },
        rawResponseDir: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    throw new CliError((err as Error).message);
  }

  const v = parsed.values;

  const options: CliOptions = {
    db: v.db,
    kindergartenId: v.kindergartenId,
    childId: v.childId,
    maxRequests: v.maxRequests ? toPositiveInt(v.maxRequests, '--maxRequests') : undefined,
    dryRun: Boolean(v.dryRun),
    resume: Boolean(v.resume),
    recheckLastSuccess: Boolean(v['recheck-last-success']),
    saveRawResponses: Boolean(v.saveRawResponses),
    rawResponseDir: v.rawResponseDir,
    help: Boolean(v.help),
  };

  if (v.startingDate) {
    // Throws a clear InvalidDateError if malformed.
    options.startingDate = normalizeDate(v.startingDate);
  }

  return options;
}
