const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/features/notes/screens/UnlistedNotesScreen.tsx'),
  'utf8',
);

test('已下架笔记的操作 sheet 提供删除入口，确认后永久删除（回收站已取消）', () => {
  assert.match(source, /import \{[^}]*\bdeleteNote\b[^}]*\} from '@\/services\/api\/notes'/);
  assert.match(source, /onPress=\{handleDeleteNote\}/);
  assert.match(source, /await deleteNote\(note\.id\)/);
  // 删除前必须二次确认，并说明删了就找不回（不删也会在下架到期后自动删除）。
  assert.match(source, /notes\.alerts\.deleteUnlistedConfirm/);
  assert.match(source, /style: 'destructive'/);
});

test('删除失败要提示用户，不能静默吞掉', () => {
  assert.match(source, /notes\.alerts\.deleteFailedTitle/);
});
