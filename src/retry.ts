/**
 * Generic retry with exponential backoff.
 *
 * Rationale for exponential backoff (vs. a fixed delay): transient failures
 * here are usually rate-limits or brief network blips. Backing off
 * progressively (500ms, 1s, 2s...) gives a struggling server room to recover
 * without hammering it, while still failing fast enough for a CLI.
 */

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  onAttempt?: (attempt: number) => void;
  onFailure?: (attempt: number, error: unknown, willRetry: boolean) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface RetryOutcome<T> {
  value: T;
  attempts: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on thrown errors up to `maxAttempts` total tries.
 * `fn` receives the 1-based attempt number. The thrown error from the final
 * attempt is re-thrown (with an `attempts` property attached).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryOutcome<T>> {
  const { maxAttempts, baseDelayMs } = options;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options.onAttempt?.(attempt);
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt };
    } catch (err) {
      lastError = err;
      const willRetry = attempt < maxAttempts;
      options.onFailure?.(attempt, err, willRetry);
      if (!willRetry) break;
      // Exponential: base * 2^(attempt-1) -> 500, 1000, 2000, ...
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  if (lastError instanceof Error) {
    (lastError as Error & { attempts?: number }).attempts = maxAttempts;
    throw lastError;
  }
  throw new Error(`Operation failed after ${maxAttempts} attempts: ${String(lastError)}`);
}
