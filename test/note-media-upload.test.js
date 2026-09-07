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

// 失焦(去选位置、去选分组)会让本批次失去所有权。此前完成路径先查所有权、失去就
// 直接 return —— 已经传完的对象被整批丢掉:字节在对象存储里,用户等的那几十秒白等。
// 现在完成路径只按「还是不是这篇笔记」决定落不落库,所有权只管弹窗和按钮态。
test('一批只处置自己的占位图，不碰同时在传的另一批', () => {
  const { createPendingNoteMediaDrafts, reconcileNoteMediaDrafts } = loadNoteMediaUpload();
  const first = createPendingNoteMediaDrafts([{ uri: 'file:///a.jpg' }], 'IMAGE');
  const second = createPendingNoteMediaDrafts([{ uri: 'file:///b.jpg' }], 'IMAGE');
  const current = [...first, ...second];
  const firstIds = new Set(first.map((item) => item.clientId));

  const afterFirstLands = reconcileNoteMediaDrafts(
    current,
    [{ clientId: first[0].clientId, objectKey: 'notes/a.jpg', url: 'https://cdn/a.jpg' }],
    firstIds,
  );

  assert.deepEqual(
    [...afterFirstLands.map((item) => item.clientId)],
    [first[0].clientId, second[0].clientId],
  );
  assert.equal(afterFirstLands[0].uploadStatus, 'UPLOADED');
  // 第二批还在传，占位图必须留着：删掉它，等它落地时就没有东西可并。
  assert.equal(afterFirstLands[1].uploadStatus, 'PENDING');
});

test('一批里传失败的占位图仍然会被本批次丢掉', () => {
  const { createPendingNoteMediaDrafts, reconcileNoteMediaDrafts } = loadNoteMediaUpload();
  const batch = createPendingNoteMediaDrafts(
    [{ uri: 'file:///ok.jpg' }, { uri: 'file:///fail.jpg' }],
    'IMAGE',
  );
  const batchIds = new Set(batch.map((item) => item.clientId));

  const settled = reconcileNoteMediaDrafts(
    batch,
    [{ clientId: batch[0].clientId, objectKey: 'notes/ok.jpg', url: 'https://cdn/ok.jpg' }],
    batchIds,
  );

  assert.deepEqual([...settled.map((item) => item.clientId)], [batch[0].clientId]);
});

// 抛错清理按 clientId 一刀切，会把同一批里已经传完、已经并回列表的那几条一起删掉 ——
// 连同已经躺在对象存储里的文件。
test('抛错清理保留同批中已经上传成功的条目', () => {
  const { createPendingNoteMediaDrafts, partitionUnsettledDrafts, reconcileNoteMediaDrafts } =
    loadNoteMediaUpload();
  const batch = createPendingNoteMediaDrafts(
    [{ uri: 'file:///done.jpg' }, { uri: 'file:///stuck.jpg' }],
    'IMAGE',
  );
  const batchIds = new Set(batch.map((item) => item.clientId));
  const withOneUploaded = reconcileNoteMediaDrafts(batch, [
    { clientId: batch[0].clientId, objectKey: 'notes/done.jpg', url: 'https://cdn/done.jpg' },
  ]).concat(batch[1]);

  const { kept, discarded } = partitionUnsettledDrafts(withOneUploaded, batchIds);

  assert.deepEqual([...kept.map((item) => item.clientId)], [batch[0].clientId]);
  assert.deepEqual([...discarded.map((item) => item.clientId)], [batch[1].clientId]);
});

// 固定报一个自造的 Error，聚合里所有失败都归并成同一个签名，而 batch.errors
// 没有任何读者 —— 「上传怎么失败的」在线上完全不可知。
test('批量失败上报真实错误，并带上出现过的错误名', () => {
  const { summarizeNoteMediaBatchFailure } = loadNoteMediaUpload();
  const timeout = new Error('timed out');
  timeout.name = 'TimeoutError';
  const forbidden = new Error('presign rejected');
  forbidden.name = 'HttpError';

  const summary = summarizeNoteMediaBatchFailure([timeout, forbidden, timeout]);

  assert.equal(summary.errorNames, 'HttpError,TimeoutError');
  // 签名按失败种类分开 —— 此前所有失败塌成同一条 message，聚合里看不出区别。
  assert.equal(summary.error.message, 'note media batch upload failed [HttpError,TimeoutError]');
  // 但原始 message 一个字都不能带出去：上传失败的 message 里常常整条带着预签名
  // URL（含令牌），而 reportHandledFailure 会把错误本身交给 Sentry。
  assert.doesNotMatch(summary.error.message, /timed out|presign rejected/);
});

test('批量失败没有错误对象时仍给出一个可上报的签名', () => {
  const { summarizeNoteMediaBatchFailure } = loadNoteMediaUpload();
  const summary = summarizeNoteMediaBatchFailure([]);

  assert.equal(summary.error.message, 'note media batch upload failed [none]');
  assert.equal(summary.errorNames, 'none');
});

// 上传失败的 message 里常常整条带着预签名 URL（含令牌），而 reportHandledFailure
// 会把错误对象本身交给 Sentry。归纳出来的错误必须与原始 message 完全无关。
test('归纳出的错误不携带原始 message 里的任何内容', () => {
  const { summarizeNoteMediaBatchFailure } = loadNoteMediaUpload();
  const leaky = new Error('PUT https://signed.example/private?token=deadbeef failed');
  leaky.name = 'StorageUploadError';

  const summary = summarizeNoteMediaBatchFailure([leaky]);

  assert.doesNotMatch(summary.error.message, /signed\.example|deadbeef|token/);
  assert.equal(summary.error.message, 'note media batch upload failed [StorageUploadError]');
});

// 错误名本身也可能是攻击面：某些库把可变文本塞进 name。只放行稳定短标识。
test('不稳定的错误名回落成 Error，不进签名', () => {
  const { summarizeNoteMediaBatchFailure } = loadNoteMediaUpload();
  const weird = new Error('boom');
  weird.name = 'failed to PUT https://signed.example/x?token=secret';

  const summary = summarizeNoteMediaBatchFailure([weird]);

  assert.equal(summary.errorNames, 'Error');
  assert.doesNotMatch(summary.error.message, /signed\.example|secret/);
});
