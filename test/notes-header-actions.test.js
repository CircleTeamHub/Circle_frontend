const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const actions = read('src/features/notes/components/NotesHeaderActions.tsx');
const screen = read('src/features/notes/screens/NotesScreen.tsx');

// 布局无法在 jest 里量宽度：这里守住「窄屏 + 大字号也不会把入口挤出屏幕」的几条约束。
test('页头入口在窄屏大字号下能收缩，不会被挤出屏幕', () => {
  // 方块可收缩、有上限宽度，但保留 44 的点击区域。
  assert.match(actions, /tile: \{\s*flexShrink: 1,\s*minWidth: 44,\s*maxWidth: \d+,\s*minHeight: 44,/);
  assert.match(actions, /tileRow: \{\s*flexShrink: 1,/);
  // 标签单行省略，系统字号放大有上限。
  assert.equal((actions.match(/maxFontSizeMultiplier=\{HEADER_LABEL_MAX_FONT_SCALE\}/g) ?? []).length, 2);
  assert.match(actions, /const HEADER_LABEL_MAX_FONT_SCALE = 1\.3;/);
  // 右侧容器占满返回键之外的宽度；页头行用 minHeight，入口变高时不溢出。
  assert.match(screen, /headerRight: \{\s*flex: 1,/);
  assert.match(screen, /headerRow: \{[^}]*minHeight: 44,/);
  assert.doesNotMatch(screen, /headerRow: \{[^}]*\bheight: 44,/);
});

test('三个入口都带文字标签和无障碍名称', () => {
  for (const key of ['notes.recycleBin', 'notes.unlisted', 'notes.drafts.title']) {
    assert.match(actions, new RegExp(key.replace(/\./g, '\\.')));
  }
  assert.match(actions, /accessibilityLabel=\{action\.label\}/);
});

test('详情页群名片：独立群（带会话 id）进群聊，圈子群仍进圈子详情', () => {
  const detail = read('src/features/notes/screens/NoteDetailScreen.tsx');
  assert.match(detail, /onGroupPress=\{handleGroupCardPress\}/);
  assert.match(detail, /if \(conversationID\) \{\s*router\.push\(\s*getChatDetailHref\(scope, conversationID, name, undefined, conversationID, undefined, 'group'\),/);
  assert.match(detail, /router\.push\(getCircleDetailHref\(scope === 'discover' \? 'discover' : 'messages', id\)\);/);
});
