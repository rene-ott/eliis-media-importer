import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../src/retry.ts';

const noSleep = async (): Promise<void> => {};

test('withRetry: succeeds on first attempt', async () => {
  let calls = 0;
  const out = await withRetry(
    async () => {
      calls++;
      return 'ok';
    },
    { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep },
  );
  assert.equal(out.value, 'ok');
  assert.equal(out.attempts, 1);
  assert.equal(calls, 1);
});

test('withRetry: retries then succeeds, reporting attempt count', async () => {
  let calls = 0;
  const out = await withRetry(
    async (attempt) => {
      calls++;
      if (attempt < 3) throw new Error(`fail ${attempt}`);
      return 'recovered';
    },
    { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep },
  );
  assert.equal(out.value, 'recovered');
  assert.equal(out.attempts, 3);
  assert.equal(calls, 3);
});

test('withRetry: gives up after maxAttempts and rethrows last error', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async (attempt) => {
          calls++;
          throw new Error(`boom ${attempt}`);
        },
        { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep },
      ),
    /boom 3/,
  );
  assert.equal(calls, 3, 'should attempt exactly maxAttempts times');
});

test('withRetry: invokes onFailure with willRetry flag', async () => {
  const events: Array<{ attempt: number; willRetry: boolean }> = [];
  await assert.rejects(() =>
    withRetry(
      async () => {
        throw new Error('x');
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1,
        sleep: noSleep,
        onFailure: (attempt, _err, willRetry) => events.push({ attempt, willRetry }),
      },
    ),
  );
  assert.deepEqual(events, [
    { attempt: 1, willRetry: true },
    { attempt: 2, willRetry: true },
    { attempt: 3, willRetry: false },
  ]);
});
