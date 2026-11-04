import test from 'node:test';
import assert from 'node:assert/strict';
import { startUploadProgress, resetUploadProgress, useUploadProgressStore } from './upload-progress-store.ts';

test.beforeEach(() => resetUploadProgress());

test('tracks concurrent image/video transfers independently and removes only the finished task', () => {
  const image = startUploadProgress('image/png', { progressKey: 'image-message' });
  const video = startUploadProgress('video/mp4', { progressKey: 'video-message' });
  assert.equal(Object.keys(useUploadProgressStore.getState().tasks).length, 2);
  image.update(50, 100);
  const imageTask = Object.values(useUploadProgressStore.getState().tasks).find(task => task.progressKey === 'image-message');
  video.update(250, 1000);
  assert.equal(Object.values(useUploadProgressStore.getState().tasks).find(task => task.progressKey === 'image-message'), imageTask);
  assert.equal(imageTask?.loaded, 50);
  image.finish();
  assert.deepEqual(Object.values(useUploadProgressStore.getState().tasks).map(task => task.progressKey), ['video-message']);
  video.finish();
  assert.deepEqual(useUploadProgressStore.getState().tasks, {});
});

test('keeps uploaded bytes at 100 percent pending the HTTP result and never manufactures completion', () => {
  const reports: unknown[] = [];
  const transfer = startUploadProgress('video/mp4', { onProgress: value => reports.push(value) });
  transfer.update(100, 100);
  assert.equal(Object.values(useUploadProgressStore.getState().tasks)[0]?.loaded, 100);
  assert.equal(Object.keys(useUploadProgressStore.getState().tasks).length, 1);
  transfer.finish();
  assert.deepEqual(reports, [{ loaded: 100, total: 100 }]);
  assert.deepEqual(useUploadProgressStore.getState().tasks, {});
});

test('an unknown total stays unknown while real received callbacks distinguish preparation from transfer', () => {
  const transfer = startUploadProgress('image/jpeg');
  assert.equal(Object.values(useUploadProgressStore.getState().tasks)[0]?.loaded, 0);
  transfer.update(500, 0);
  const task = Object.values(useUploadProgressStore.getState().tasks)[0];
  assert.equal(task?.loaded, 500);
  assert.equal(task?.total, null);
  transfer.update(600, 1000);
  assert.equal(Object.values(useUploadProgressStore.getState().tasks)[0]?.total, 1000);
  transfer.finish();
});

test('deduplicates whole-percent updates rather than notifying React for every network chunk', () => {
  const transfer = startUploadProgress('video/mp4');
  let notifications = 0;
  const unsubscribe = useUploadProgressStore.subscribe(() => notifications++);
  for (let loaded = 0; loaded <= 1000; loaded++) transfer.update(loaded, 1000);
  unsubscribe();
  assert.equal(notifications, 101);
  assert.equal(Object.values(useUploadProgressStore.getState().tasks)[0]?.loaded, 1000);
  transfer.finish();
});

test('reset fences late callbacks and finishing an old transfer cannot remove a new one', () => {
  const reports: unknown[] = [];
  const old = startUploadProgress('image/jpeg', { progressKey: 'old', onProgress: value => reports.push(value) });
  resetUploadProgress();
  const current = startUploadProgress('video/mp4', { progressKey: 'new' });
  old.update(60, 100);
  old.finish();
  assert.deepEqual(reports, []);
  assert.deepEqual(Object.values(useUploadProgressStore.getState().tasks).map(task => task.progressKey), ['new']);
  current.finish();
  current.update(100, 100);
  assert.deepEqual(useUploadProgressStore.getState().tasks, {});
});

test('normalizes native byte values once and keeps only progress metadata in memory', () => {
  const transfer = startUploadProgress('image/jpeg');
  transfer.update(-10, Number.NaN);
  transfer.update(200, 100);
  const task = Object.values(useUploadProgressStore.getState().tasks)[0];
  assert.equal(task?.loaded, 100);
  assert.equal(task?.total, 100);
  assert.deepEqual(Object.keys(task).sort(), ['id', 'kind', 'loaded', 'total']);
  transfer.finish();
});

test('audio transfers do not create image/video progress cards', () => {
  const transfer = startUploadProgress('audio/mp4');
  transfer.update(10, 100);
  assert.deepEqual(useUploadProgressStore.getState().tasks, {});
  transfer.finish();
});
