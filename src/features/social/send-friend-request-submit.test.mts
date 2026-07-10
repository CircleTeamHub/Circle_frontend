import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSingleFlightRunner,
  getFriendRequestSubmitState,
} from './send-friend-request-submit.ts';

test('friend request submit is disabled without a profile', () => {
  assert.deepEqual(
    getFriendRequestSubmitState({
      hasProfile: false,
      isSubmitting: false,
      isUploadingPhoto: false,
    }),
    { disabled: true, activity: 'idle' },
  );
});

test('friend request submit is disabled while submitting', () => {
  assert.deepEqual(
    getFriendRequestSubmitState({
      hasProfile: true,
      isSubmitting: true,
      isUploadingPhoto: false,
    }),
    { disabled: true, activity: 'submitting' },
  );
});

test('friend request submit is disabled while a photo is uploading', () => {
  assert.deepEqual(
    getFriendRequestSubmitState({
      hasProfile: true,
      isSubmitting: false,
      isUploadingPhoto: true,
    }),
    { disabled: true, activity: 'uploading' },
  );
});

test('friend request submit is enabled when ready', () => {
  assert.deepEqual(
    getFriendRequestSubmitState({
      hasProfile: true,
      isSubmitting: false,
      isUploadingPhoto: false,
    }),
    { disabled: false, activity: 'idle' },
  );
});

test('single-flight runner starts one task for two synchronous calls and releases after success', async () => {
  let resolveTask: () => void = () => {};
  const task = () =>
    new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
  const runner = createSingleFlightRunner();

  const first = runner.run(task);
  const second = runner.run(task);

  assert.equal(runner.isRunning(), true);
  assert.equal(second, null);
  resolveTask();
  await first;
  assert.equal(runner.isRunning(), false);

  const third = runner.run(async () => {});
  assert.notEqual(third, null);
  await third;
});

test('single-flight runner releases after failure', async () => {
  const runner = createSingleFlightRunner();
  const failure = new Error('failed');

  await assert.rejects(runner.run(async () => Promise.reject(failure))!, failure);
  assert.equal(runner.isRunning(), false);
  assert.notEqual(runner.run(async () => {}), null);
});
