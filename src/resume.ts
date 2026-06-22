/**
 * Resume / start-point logic.
 *
 * Decides which date the crawl should begin at, based on CLI flags and the
 * existing request history. Pure function over the relevant request rows so it
 * can be unit-tested without a database.
 *
 * Cursor semantics: a successful request stores the response's `next_date`.
 * To continue the crawl we issue the next request with `date = next_date`, and
 * that request's own `current_date` is also that cursor value.
 */

import type { RequestRow } from './types.ts';

export interface ResumeInputs {
  /** Normalized YYYY-MM-DD from --startingDate, if provided. */
  startingDate?: string;
  /** --recheck-last-success flag. */
  recheckLastSuccess: boolean;
  /** Latest request row by id (any status), or undefined if table is empty. */
  latestRequest?: RequestRow;
  /** Latest successful request row by id, or undefined. */
  latestSuccess?: RequestRow;
}

export type ResumeDecision =
  | { action: 'start'; date: string; reason: string }
  | { action: 'complete'; reason: string };

export function decideStart(inputs: ResumeInputs): ResumeDecision {
  const { startingDate, recheckLastSuccess, latestRequest, latestSuccess } = inputs;

  // 1. Explicit starting date always wins.
  if (startingDate) {
    return {
      action: 'start',
      date: startingDate,
      reason: `explicit --startingDate ${startingDate}`,
    };
  }

  // 2. Intentionally re-run the latest successful param_date.
  if (recheckLastSuccess) {
    if (latestSuccess) {
      return {
        action: 'start',
        date: latestSuccess.param_date,
        reason: `--recheck-last-success: re-running ${latestSuccess.param_date}`,
      };
    }
    return {
      action: 'complete',
      reason: '--recheck-last-success given but no successful request exists yet',
    };
  }

  // 3. Nothing in the table — cannot resume.
  if (!latestRequest) {
    return {
      action: 'complete',
      reason: 'no history to resume from; pass --startingDate to begin',
    };
  }

  // 4. If the most recent request errored, retry that date first.
  if (latestRequest.status === 'error') {
    return {
      action: 'start',
      date: latestRequest.param_date,
      reason: `retrying last errored date ${latestRequest.param_date}`,
    };
  }

  // 5. Otherwise resume from the latest successful request's cursor.
  if (latestSuccess) {
    const next = latestSuccess.next_date;
    if (next && next.trim().length > 0) {
      return {
        action: 'start',
        date: next.trim(),
        reason: `resuming from last success next_date ${next.trim()}`,
      };
    }
    return {
      action: 'complete',
      reason: `crawl complete: last success (${latestSuccess.param_date}) had no next_date`,
    };
  }

  // 6. Latest request is pending (e.g. interrupted) but no success yet —
  //    safest is to re-run that pending date.
  return {
    action: 'start',
    date: latestRequest.param_date,
    reason: `re-running interrupted/pending date ${latestRequest.param_date}`,
  };
}
