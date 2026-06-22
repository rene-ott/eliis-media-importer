/**
 * Resolves runtime configuration by merging (in order of precedence):
 *   CLI flags  >  environment variables  >  built-in defaults.
 *
 * Secrets (the auth cookie) come ONLY from the environment, never from CLI
 * flags (which would leak into shell history / process listings).
 */

import { readFileSync } from 'node:fs';
import type { CliOptions } from './cli.ts';

export interface AppConfig {
  baseUrl: string;
  kindergartenId: string;
  childId: string;
  cookie: string | null;
  headers: Record<string, string>;
  dbPath: string;
  maxRequests: number | null;
  dryRun: boolean;
  saveRawResponses: boolean;
  rawResponseDir: string;
  maxAttempts: number;
  backoffBaseMs: number;
  requestDelayMs: number;
}

const DEFAULT_BASE_URL = 'https://api.eliis.eu';
const DEFAULT_DB_PATH = './eliis.sqlite';
const DEFAULT_RAW_DIR = './raw-responses';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_REQUEST_DELAY_MS = 250;

/**
 * Best-effort .env loader (no dependency). Parses simple `KEY=VALUE` lines,
 * supports quotes and `#` comments. Existing process.env values win.
 */
export function loadDotEnv(path = '.env'): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return; // no .env file — fine, rely on real environment
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const SAFE_DEFAULT_HEADERS: Record<string, string> = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'x-requested-with': 'XMLHttpRequest',
  origin: 'https://eliis.eu',
  referer: 'https://eliis.eu/',
};

function parseExtraHeaders(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k.toLowerCase()] = v;
    }
    return out;
  } catch {
    throw new Error('ELIIS_EXTRA_HEADERS must be a JSON object of string values.');
  }
}

export class ConfigError extends Error {}

/**
 * Build the effective {@link AppConfig}. Requires kindergartenId + childId from
 * either CLI or env. The cookie is optional here (validated lazily by the API
 * layer) so that `--dryRun` against fixtures and offline tests can run.
 */
export function resolveConfig(cli: CliOptions): AppConfig {
  const env = process.env;

  const kindergartenId = cli.kindergartenId ?? env.ELIIS_KINDERGARTEN_ID;
  const childId = cli.childId ?? env.ELIIS_CHILD_ID;

  if (!kindergartenId) {
    throw new ConfigError(
      'Missing kindergarten id. Pass --kindergartenId or set ELIIS_KINDERGARTEN_ID.',
    );
  }
  if (!childId) {
    throw new ConfigError(
      'Missing child id. Pass --childId or set ELIIS_CHILD_ID.',
    );
  }

  const cookie = env.ELIIS_COOKIE && env.ELIIS_COOKIE.trim().length > 0
    ? env.ELIIS_COOKIE.trim()
    : null;

  const headers: Record<string, string> = {
    ...SAFE_DEFAULT_HEADERS,
    ...parseExtraHeaders(env.ELIIS_EXTRA_HEADERS),
  };
  if (cookie) headers.cookie = cookie;

  return {
    baseUrl: (env.ELIIS_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    kindergartenId: String(kindergartenId),
    childId: String(childId),
    cookie,
    headers,
    dbPath: cli.db ?? DEFAULT_DB_PATH,
    maxRequests: cli.maxRequests ?? null,
    dryRun: cli.dryRun,
    saveRawResponses: cli.saveRawResponses,
    rawResponseDir: cli.rawResponseDir ?? DEFAULT_RAW_DIR,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
  };
}
