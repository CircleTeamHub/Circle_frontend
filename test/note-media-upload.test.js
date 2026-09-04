const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadNoteMediaUpload() {
  const filePath = path.join(
    process.cwd(),
    'src/features/notes/utils/note-media-upload.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, exports: {}, Promise, setTimeout };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('batch uploader keeps successful assets in picker order while reporting failures', async () => {
  const { uploadNoteMediaBatch } = loadNoteMediaUpload();
  let active = 0;
  let peakActive = 0;
  const result = await uploadNoteMediaBatch(
    ['first', 'second', 'third', 'fourth'],
    async (asset) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise((resolve) => setTimeout(resolve, asset === 'first' ? 20 : 1));
      active -= 1;
      if (asset === 'second') throw new Error('network failed');
      return asset.toUpperCase();
    },
    { concurrency: 2 },
  );

  assert.deepEqual([...result.items], ['FIRST', 'THIRD', 'FOURTH']);
  assert.equal(result.failedCount, 1);
  assert.deepEqual([...result.failedIndexes], [1]);
  assert.ok(peakActive <= 2, `expected at most two uploads, saw ${peakActive}`);
});

test('batch uploader uses a conservative default concurrency limit', async () => {
  const { NOTE_MEDIA_UPLOAD_CONCURRENCY, uploadNoteMediaBatch } = loadNoteMediaUpload();
  const result = await uploadNoteMediaBatch([1, 2], async (value) => value);

  assert.ok(NOTE_MEDIA_UPLOAD_CONCURRENCY > 0 && NOTE_MEDIA_UPLOAD_CONCURRENCY <= 3);
  assert.deepEqual([...result.items], [1, 2]);
  assert.equal(result.failedCount, 0);
});

test('pending drafts show local previews immediately, block save, and retain only settled successes', () => {
  const {
    canSubmitNoteMedia,
    createPendingNoteMediaDrafts,
    reconcileNoteMediaDrafts,
    stripEditorMediaDrafts,
  } = loadNoteMediaUpload();
  const pending = createPendingNoteMediaDrafts([
    { uri: 'file:///fast.jpg', width: 100, height: 80 },
    { uri: 'file:///slow.jpg', width: 200, height: 160 },
  ], 'IMAGE');

  assert.deepEqual([...pending.map((item) => item.previewUri)], [
    'file:///fast.jpg',
    'file:///slow.jpg',
  ]);
  assert.equal(canSubmitNoteMedia(pending), false);

  const settled = reconcileNoteMediaDrafts(pending, [
    { clientId: pending[0].clientId, objectKey: 'notes/fast.jpg', url: 'https://cdn/fast.jpg' },
  ]);
  assert.equal(settled.length, 1);
  assert.equal(canSubmitNoteMedia(settled), true);
  assert.deepEqual(JSON.parse(JSON.stringify(stripEditorMediaDrafts(settled))), [
    {
      type: 'IMAGE',
      objectKey: 'notes/fast.jpg',
      url: 'https://cdn/fast.jpg',
      width: 100,
      height: 80,
      sortOrder: 0,
    },
  ]);
});

test('same local asset receives independent opaque draft identities across picker batches', () => {
  const { createPendingNoteMediaDrafts, reconcileNoteMediaDrafts } = loadNoteMediaUpload();
  const asset = { uri: 'file:///library/reselected.jpg' };
  const firstBatch = createPendingNoteMediaDrafts([asset], 'IMAGE');
  const secondBatch = createPendingNoteMediaDrafts([asset], 'IMAGE');

  assert.notEqual(firstBatch[0].clientId, secondBatch[0].clientId);
  assert.doesNotMatch(firstBatch[0].clientId, /reselected\.jpg/);

  const firstUploaded = reconcileNoteMediaDrafts(firstBatch, [
    { clientId: firstBatch[0].clientId, objectKey: 'notes/first.jpg', url: 'https://cdn/first.jpg' },
  ]);
  const current = [...firstUploaded, ...secondBatch];
  const afterRemovingFirst = current.filter((item) => item.clientId !== firstBatch[0].clientId);
  const reconciled = reconcileNoteMediaDrafts(afterRemovingFirst, [
    { clientId: secondBatch[0].clientId, objectKey: 'notes/second.jpg', url: 'https://cdn/second.jpg' },
  ]);

  assert.deepEqual([...reconciled.map((item) => item.clientId)], [secondBatch[0].clientId]);
  assert.equal(reconciled[0].objectKey, 'notes/second.jpg');
  assert.equal(reconciled[0].uploadStatus, 'UPLOADED');
});

test('upload operation ownership ignores stale work after a route blur without unlocking a newer upload', async () => {
  const { createNoteMediaUploadOperationGuard } = loadNoteMediaUpload();
  const guard = createNoteMediaUploadOperationGuard();
  const staleToken = guard.begin();
  const deferred = new Promise((resolve) => setTimeout(resolve, 1));
  guard.invalidate();
  await deferred;

  const currentToken = guard.begin();
  assert.equal(guard.isActive(staleToken), false);
  assert.equal(guard.complete(staleToken), false);
  assert.equal(guard.isActive(currentToken), true);
  assert.equal(guard.complete(currentToken), true);
  assert.equal(guard.isActive(currentToken), false);
});
