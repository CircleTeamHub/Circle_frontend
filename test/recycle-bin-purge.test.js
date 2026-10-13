const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('回收站操作 sheet 提供「立即删除」，二次确认后调用永久删除接口', () => {
  const screen = read('src/features/notes/screens/RecycleBinScreen.tsx');
  assert.match(screen, /onPress=\{handlePurge\}/);
  assert.match(screen, /await purgeNote\(note\.id\)/);
  assert.match(screen, /notes\.alerts\.purgeConfirm/);
  assert.match(screen, /style: 'destructive'/);
  // 删除失败要提示，不能静默吞掉。
  assert.match(screen, /notes\.alerts\.deleteFailedTitle/);
});

test('永久删除走 DELETE /note/:id/permanent（后端只接受已在回收站的笔记）', () => {
  const api = read('src/services/api/notes.ts');
  assert.match(api, /export async function purgeNote/);
  assert.match(api, /\/note\/\$\{id\}\/permanent`, \{ method: 'DELETE' \}/);
});

test('立即删除文案五种语言齐全', () => {
  for (const lng of ['zh', 'en', 'ja', 'ko', 'es']) {
    const notes = JSON.parse(read(`src/i18n/locales/${lng}.json`)).notes;
    for (const value of [notes.actions.purge, notes.alerts.purgeTitle, notes.alerts.purgeConfirm]) {
      assert.equal(typeof value, 'string', lng);
      assert.ok(value.length > 0, lng);
    }
  }
});
