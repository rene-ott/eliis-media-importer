/**
 * ELIIS guardian-feed API client. Uses Node's native global `fetch`
 * (Node >= 18), so no HTTP dependency is required.
 */

import { createHash } from 'node:crypto';
import type { AppConfig } from './config.ts';
import type { GuardianFeedResponse } from './types.ts';

export interface FetchResult {
  httpStatus: number;
  /** Raw response body text (used for hashing / optional raw save). */
  rawBody: string;
  /** sha256 of `rawBody`, for change detection. */
  responseHash: string;
  json: GuardianFeedResponse;
}

/** Thrown for non-2xx responses or unparseable bodies. Carries httpStatus. */
export class ApiError extends Error {
  readonly httpStatus: number | null;
  readonly rawBody: string | null;
  constructor(message: string, httpStatus: number | null, rawBody: string | null) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.rawBody = rawBody;
  }
}

export function buildFeedUrl(config: AppConfig, date: string): string {
  const { baseUrl, kindergartenId, childId } = config;
  const path = `/api/kindergartens/${encodeURIComponent(
    kindergartenId,
  )}/children/${encodeURIComponent(childId)}/guardian-feed`;
  return `${baseUrl}${path}?date=${encodeURIComponent(date)}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Fetch one guardian-feed page. Throws {@link ApiError} on HTTP error status
 * or invalid JSON so the retry layer can react.
 */
export async function fetchGuardianFeed(
  config: AppConfig,
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchResult> {
  const url = buildFeedUrl(config, date);

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers: config.headers });
  } catch (err) {
    // Network-level failure (DNS, connection reset, etc.) — retryable.
    throw new ApiError(`Network error fetching ${date}: ${(err as Error).message}`, null, null);
  }

  const rawBody = await response.text();

  if (!response.ok) {
    throw new ApiError(
      `HTTP ${response.status} ${response.statusText} for date ${date}`,
      response.status,
      rawBody,
    );
  }

  let json: GuardianFeedResponse;
  try {
    json = JSON.parse(rawBody) as GuardianFeedResponse;
  } catch {
    throw new ApiError(
      `Invalid JSON in response for date ${date}`,
      response.status,
      rawBody,
    );
  }

  if (!json || !Array.isArray(json.data)) {
    throw new ApiError(
      `Unexpected response shape for date ${date} (missing data[])`,
      response.status,
      rawBody,
    );
  }

  return {
    httpStatus: response.status,
    rawBody,
    responseHash: sha256(rawBody),
    json,
  };
}
