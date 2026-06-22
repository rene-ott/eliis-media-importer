#!/usr/bin/env node
/**
 * Entry point: orchestrates the paginated crawl.
 *
 * For each cursor date it issues one logical request (with up to N attempts),
 * extracts media, persists everything in a transaction, then follows the
 * response's next_date until the crawl completes, errors, or hits --maxRequests.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchGuardianFeed, ApiError } from './api.ts';
import { CliError, HELP_TEXT, parseCliArgs, type CliOptions } from './cli.ts';
import { ConfigError, loadDotEnv, resolveConfig, type AppConfig } from './config.ts';
import { ImporterDb } from './db.ts';
import { extractMedia, getNextDate } from './extractor.ts';
import { decideStart } from './resume.ts';
import { withRetry } from './retry.ts';
import { InvalidDateError } from './utils/dates.ts';
import { createLogger, type Logger } from './utils/logging.ts';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => (ms > 0 ? setTimeout(resolve, ms) : resolve()));

function nowIso(): string {
  return new Date().toISOString();
}

function saveRawResponse(config: AppConfig, date: string, body: string): string {
  mkdirSync(config.rawResponseDir, { recursive: true });
  const path = join(config.rawResponseDir, `${date}.json`);
  writeFileSync(path, body, 'utf8');
  return path;
}

async function run(cli: CliOptions, log: Logger): Promise<number> {
  loadDotEnv();
  const config = resolveConfig(cli);

  if (!config.dryRun && !config.cookie) {
    log.warn(
      'No ELIIS_COOKIE set — requests will likely fail with 401. ' +
        'Set it in .env or the environment (see .env.example).',
    );
  }

  // A dry run writes nothing, so it never opens the on-disk DB — it uses an
  // in-memory one purely so the code paths stay uniform. (This also avoids
  // touching the filesystem at all, which matters on mounts where SQLite
  // locking is unreliable.)
  const db = new ImporterDb(config.dryRun ? ':memory:' : config.dbPath);
  log.info(`Database: ${config.dryRun ? ':memory: (dry run)' : config.dbPath}`);
  log.info(
    `Target: kindergarten ${config.kindergartenId}, child ${config.childId}` +
      (config.dryRun ? ' (dry run — no writes)' : ''),
  );

  try {
    const decision = decideStart({
      startingDate: cli.startingDate,
      recheckLastSuccess: cli.recheckLastSuccess,
      latestRequest: db.getLatestRequest(),
      latestSuccess: db.getLatestSuccess(),
    });

    if (decision.action === 'complete') {
      log.info(`Nothing to do — ${decision.reason}.`);
      return 0;
    }

    log.info(`Start: ${decision.date} (${decision.reason}).`);

    let date: string | null = decision.date;
    const visited = new Set<string>();
    let requestCount = 0;
    let totalInserted = 0;
    let totalDuplicates = 0;
    let completionReason = 'unknown';

    while (date) {
      if (config.maxRequests != null && requestCount >= config.maxRequests) {
        completionReason = `reached --maxRequests (${config.maxRequests})`;
        break;
      }
      if (visited.has(date)) {
        completionReason = `cursor revisited ${date} — stopping to avoid a loop`;
        break;
      }
      visited.add(date);

      const paramDate = date;
      const startedAt = nowIso();
      const t0 = Date.now();
      log.info(`-> Request #${requestCount + 1} date=${paramDate}`);

      // One logical request row (per task: one row per logical request, not per attempt).
      const requestId = config.dryRun
        ? -1
        : db.createPendingRequest({
            param_date: paramDate,
            current_date: paramDate,
            kindergarten_id: config.kindergartenId,
            child_id: config.childId,
            started_at: startedAt,
          });

      let attemptsUsed = 1;
      try {
        const outcome = await withRetry(
          (attempt) => {
            attemptsUsed = attempt;
            if (!config.dryRun) db.setAttemptCount(requestId, attempt);
            return fetchGuardianFeed(config, paramDate);
          },
          {
            maxAttempts: config.maxAttempts,
            baseDelayMs: config.backoffBaseMs,
            onFailure: (attempt, err, willRetry) => {
              const status = err instanceof ApiError ? err.httpStatus : null;
              log.warn(
                `   attempt ${attempt}/${config.maxAttempts} failed` +
                  (status ? ` (HTTP ${status})` : '') +
                  `: ${(err as Error).message}` +
                  (willRetry ? ' — retrying...' : ''),
              );
            },
          },
        );

        const { httpStatus, json, rawBody, responseHash } = outcome.value;
        const media = extractMedia(json);
        const nextDate = getNextDate(json);

        let rawPath: string | null = null;
        if (config.saveRawResponses && !config.dryRun) {
          rawPath = saveRawResponse(config, paramDate, rawBody);
        }

        const durationMs = Date.now() - t0;

        if (config.dryRun) {
          log.info(
            `   [dry] HTTP ${httpStatus} | media=${media.length} | ` +
              `next_date=${nextDate ?? '(none)'} | ${durationMs}ms`,
          );
        } else {
          const res = db.finalizeSuccess(requestId, outcome.attempts, media, {
            next_date: nextDate,
            http_status: httpStatus,
            duration_ms: durationMs,
            media_file_count: media.length,
            response_hash: responseHash,
            raw_response_saved: rawPath != null,
            raw_response_path: rawPath,
            finished_at: nowIso(),
          });
          totalInserted += res.inserted;
          totalDuplicates += res.duplicates;
          log.info(
            `   HTTP ${httpStatus} | media=${media.length} ` +
              `(new ${res.inserted}, dup ${res.duplicates}) | ` +
              `next_date=${nextDate ?? '(none)'} | attempts=${outcome.attempts} | ${durationMs}ms`,
          );
        }

        requestCount++;

        if (!nextDate) {
          completionReason = `no next_date after ${paramDate} — crawl complete`;
          break;
        }
        date = nextDate;
        await sleep(config.requestDelayMs);
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : null;
        const message = (err as Error).message;
        const durationMs = Date.now() - t0;
        if (!config.dryRun) {
          db.markRequestError(requestId, attemptsUsed, {
            http_status: apiErr?.httpStatus ?? null,
            error_message: message,
            duration_ms: durationMs,
            finished_at: nowIso(),
          });
        }
        log.error(
          `   request for ${paramDate} failed after ${attemptsUsed} attempt(s): ${message}`,
        );
        completionReason = `stopped on error at ${paramDate}`;
        log.info(
          `Summary: ${requestCount} request(s) ok, ${totalInserted} new media, ` +
            `${totalDuplicates} duplicate(s). Reason: ${completionReason}.`,
        );
        log.info('Re-run with --resume to retry the failed date.');
        return 1;
      }
    }

    log.info(
      `Done. ${requestCount} request(s), ${totalInserted} new media, ` +
        `${totalDuplicates} duplicate(s). Reason: ${completionReason}.`,
    );
    if (!config.dryRun) {
      log.info(
        `Totals in DB: ${db.countMediaFiles()} media file(s), ` +
          `${db.countByStatus('success')} successful request(s), ` +
          `${db.countByStatus('error')} errored.`,
      );
    }
    return 0;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const log = createLogger((process.env.LOG_LEVEL as never) || 'info');
  let cli: CliOptions;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError || err instanceof InvalidDateError) {
      console.error(`Error: ${err.message}`);
      console.error(HELP_TEXT);
      process.exit(2);
    }
    throw err;
  }

  if (cli.help) {
    console.log(HELP_TEXT);
    return;
  }

  try {
    const code = await run(cli, log);
    process.exitCode = code;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}`);
      process.exitCode = 2;
      return;
    }
    log.error(`Fatal: ${(err as Error).message}`);
    if (process.env.LOG_LEVEL === 'debug') console.error(err);
    process.exitCode = 1;
  }
}

void main();
