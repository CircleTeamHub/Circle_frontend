const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function sectionMediaHandler() {
  const source = read('src/features/notes/screens/EditNoteScreen.tsx');
  const start = source.indexOf('const handleAddSectionMedia = useCallback(');
  assert.ok(start > 0, 'handleAddSectionMedia should exist');
  const end = source.indexOf('const handleRemoveSectionMedia', start);
  assert.ok(end > start, 'handleRemoveSectionMedia should follow it');
  return source.slice(start, end);
}

// 一次上传要经过 presign + PUT，几十秒起步。这段时间里用户去选个位置、挑个分组，
// 本页就失去焦点，本批次也就失去「所有权」。完成路径原本头一句就是查所有权、
// 失去就 return —— 于是**已经传完**的对象被整批丢掉：字节已经在对象存储里躺着，
// 丢掉的是用户刚等完的那几十秒和一份已经付过的流量。
//
// 所有权只该管 UI 副作用（弹窗、按钮态）。结果落不落库另有判据：还是不是这篇笔记。
test('上传结果先落库再谈所有权，失焦不丢已经传完的文件', () => {
  const handler = sectionMediaHandler();
  const commit = handler.indexOf('reconcileNoteMediaDrafts(current, batch.items');
  const ownershipCheck = handler.indexOf(
    'isActive(operationToken)) return;',
    handler.indexOf('const batch = await uploadNoteMediaBatch('),
  );

  assert.ok(commit > 0, '完成路径应当调用 reconcileNoteMediaDrafts');
  assert.ok(ownershipCheck > 0, 'await 之后应当仍有一次所有权判断（用于弹窗）');
  assert.ok(
    commit < ownershipCheck,
    '结果必须在所有权判断之前落库，否则失焦会丢掉已经上传的对象',
  );
  // 落库的闸是笔记身份，不是焦点。
  assert.match(handler, /if \(stillEditingSameNote\(\)\) \{/);
});

test('抛错清理与失败上报同样不看所有权', () => {
  const handler = sectionMediaHandler();
  const catchAt = handler.indexOf('} catch (error) {');
  const cleanup = handler.indexOf('partitionUnsettledDrafts(items, batchDraftIds)', catchAt);
  const report = handler.indexOf("reportHandledFailure('noteEditor', 'sectionMediaUpload'", catchAt);
  const ownershipCheck = handler.indexOf('isActive(operationToken)) return;', catchAt);

  assert.ok(cleanup > catchAt && cleanup < ownershipCheck, '占位图清理必须先于所有权判断');
  assert.ok(report > catchAt && report < ownershipCheck, '失败上报必须先于所有权判断');
});

// 交回所有权时顺手删掉在飞批次的占位图，是丢文件的另一个入口：失焦后回到本页时
// 批次往往还没落地，占位图一删，等它落地就没有东西可并。去留只该由批次自己的
// 完成路径决定。
test('交回上传所有权不动列表里的草稿', () => {
  const source = read('src/features/notes/screens/EditNoteScreen.tsx');
  const start = source.indexOf('const resetUploadOwnership = useCallback(');
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf('}, [invalidateUploadOwnership]);', start));

  assert.doesNotMatch(body, /setMediaItems\(/);
  assert.doesNotMatch(body, /setShowcaseItems\(/);
});

// 一批的完成路径不能处置别的批次：失焦会把 uploadInFlightRef 复位，两批上传因此
// 可以叠着跑，先落地的那批会把后一批的占位图连同它正在传的文件一起抹掉。
test('并回结果时带上本批次的 clientId 范围', () => {
  const handler = sectionMediaHandler();

  assert.match(handler, /reconcileNoteMediaDrafts\(current, batch\.items, batchDraftIds\)/);
});

// batch.errors 此前没有任何读者，所有失败在聚合里归并成同一个签名。
test('批量上传失败上报真实错误而不是自造的占位错误', () => {
  const handler = sectionMediaHandler();

  assert.match(handler, /summarizeNoteMediaBatchFailure\(batch\.errors\)/);
  assert.doesNotMatch(handler, /new Error\('note media batch upload failed'\)/);
});
