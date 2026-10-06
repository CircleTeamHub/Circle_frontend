import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMediaUploadScheduler,
  splitPhotoSelection,
} from './media-upload-scheduler.ts';

test('limits active uploads and starts queued work in FIFO order', async () => {
  const scheduler = createMediaUploadScheduler({ concurrency: 2 });
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  let active = 0;
  let maxActive = 0;
  const started: number[] = [];
  const release: Array<() => void> = [];

  const tasks = [0, 1, 2, 3].map((id) =>
    scheduler.enqueue(
      () =>
        new Promise<number>((resolve) => {
          started.push(id);
          active += 1;
          maxActive = Math.max(maxActive, active);
          release.push(() => {
            active -= 1;
            resolve(id);
          });
        }),
    ),
  );

  assert.deepEqual(started, [0, 1]);
  assert.equal(scheduler.activeCount, 2);
  assert.equal(scheduler.pendingCount, 2);

  release.shift()?.();
  await flush();
  assert.deepEqual(started, [0, 1, 2]);
  release.shift()?.();
  await flush();
  assert.deepEqual(started, [0, 1, 2, 3]);

  release.shift()?.();
  release.shift()?.();
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3]);
  assert.equal(maxActive, 2);
  assert.equal(scheduler.activeCount, 0);
  assert.equal(scheduler.pendingCount, 0);
});

test('a rejected upload does not stall later queued work', async () => {
  const scheduler = createMediaUploadScheduler({ concurrency: 1 });
  const calls: string[] = [];

  const failed = scheduler.enqueue(async () => {
    calls.push('failed');
    throw new Error('upload failed');
  });
  const succeeded = scheduler.enqueue(async () => {
    calls.push('succeeded');
    return 'ok';
  });

  await assert.rejects(failed, /upload failed/);
  assert.equal(await succeeded, 'ok');
  assert.deepEqual(calls, ['failed', 'succeeded']);
});

test('supports a configurable concurrency and validates invalid values', async () => {
  const scheduler = createMediaUploadScheduler({ concurrency: 3 });
  const result = await Promise.all([
    scheduler.enqueue(() => 1),
    scheduler.enqueue(() => 2),
    scheduler.enqueue(() => 3),
  ]);
  assert.deepEqual(result, [1, 2, 3]);
  assert.throws(
    () => createMediaUploadScheduler({ concurrency: 0 }),
    /positive integer/,
  );
  assert.throws(
    () => createMediaUploadScheduler({ concurrency: 1.5 }),
    /positive integer/,
  );
});

test('keeps the editor for one photo and sends every photo in a batch', () => {
  const one = { id: 'one' };
  assert.deepEqual(splitPhotoSelection([one]), {
    editorAsset: one,
    uploadAssets: [],
  });

  const many = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  assert.deepEqual(splitPhotoSelection(many), {
    editorAsset: null,
    uploadAssets: many,
  });
});
