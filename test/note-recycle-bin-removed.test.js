const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const exists = (file) => fs.existsSync(path.join(process.cwd(), file));

// 产品决定（2026-11-13）：取消回收站。删除 = 立即永久删除；想留后悔余地就下架，
// 下架 60 天后服务端自动删除。别让回收站的页面、入口或接口悄悄回来。
test('回收站页面、路由和入口都已移除', () => {
  assert.equal(exists('src/features/notes/screens/RecycleBinScreen.tsx'), false);
  assert.equal(exists('app/(tabs)/profile/notes/recycle-bin.tsx'), false);
  assert.doesNotMatch(read('src/features/notes/components/NotesHeaderActions.tsx'), /recycleBin|回收站/);
  assert.doesNotMatch(read('src/features/notes/screens/NotesScreen.tsx'), /recycle-bin|RecycleBin/);
});

test('前端不再调用回收站接口', () => {
  const api = read('src/services/api/notes.ts');
  assert.doesNotMatch(api, /\/note\/recycle-bin|\/permanent`|\/restore`/);
  assert.doesNotMatch(api, /export async function (purgeNote|restoreNote|fetchDeletedNotes)/);
});

test('删除确认讲清楚无法恢复，并指向下架这条后悔路', () => {
  for (const lng of ['zh', 'en', 'ja', 'ko', 'es']) {
    const notes = JSON.parse(read(`src/i18n/locales/${lng}.json`)).notes;
    assert.equal(notes.recycleBin, undefined, lng);
    assert.ok(notes.alerts.deleteConfirm.includes('60'), lng);
    assert.ok(notes.unlistedAutoDeleteHint.includes('60'), lng);
  }
  assert.match(
    JSON.parse(read('src/i18n/locales/zh.json')).notes.alerts.deleteConfirm,
    /无法恢复/,
  );
});
