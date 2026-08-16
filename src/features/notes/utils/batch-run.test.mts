import test from 'node:test';
import assert from 'node:assert/strict';
import { runNoteBatch } from './batch-run.ts';

test('runNoteBatch settles every id into succeeded or failed buckets', async () => {
  const calls: string[] = [];
  const result = await runNoteBatch(['a', 'bad', 'b'], async (id) => {
    calls.push(id);
    if (id === 'bad') throw new Error('boom');
  });

  assert.deepEqual(result.succeeded, ['a', 'b']);
  assert.deepEqual(result.failed, ['bad']);
  // 一条失败不会截断后续任务
  assert.deepEqual(calls, ['a', 'bad', 'b']);
});

test('runNoteBatch caps in-flight tasks at the concurrency limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);

  await runNoteBatch(
    ids,
    async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    },
    5,
  );

  assert.ok(peak <= 5, `peak in-flight ${peak} exceeded limit`);
});

test('runNoteBatch tolerates an empty id list and a zero/negative limit', async () => {
  assert.deepEqual(await runNoteBatch([], async () => {}), {
    succeeded: [],
    failed: [],
  });
  const result = await runNoteBatch(['a'], async () => {}, 0);
  assert.deepEqual(result.succeeded, ['a']);
});
