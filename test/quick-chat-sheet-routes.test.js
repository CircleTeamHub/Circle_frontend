const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 半屏聊天里打开的「选完回到聊天」页面必须是盖在半屏上的模态(app/chat-sheet/*)。
// 行为由 src/features/chat/chat-detail/hooks/use-chat-router.spec.tsx 用真实路由跑;
// 这里只钉住那份测试里缩写的路由树和真实 app/ 目录一致。

const SHEET_PAGES = {
  'share-picker': 'SharePickerScreen',
  'transfer-composer': 'TransferComposerScreen',
  'location-picker': 'ChatLocationPickerScreen',
};

test('root stack presents chat-sheet as a full-screen modal over the quick-chat sheet', () => {
  const layout = read('app/_layout.tsx');
  const quickChat = layout.indexOf('name="quick-chat"');
  const chatSheet = layout.indexOf('name="chat-sheet"');
  assert.ok(quickChat > 0, 'quick-chat route missing from the root stack');
  assert.ok(chatSheet > quickChat, 'chat-sheet must be registered after quick-chat');
  // 卡片式 modal 在 iOS 上不铺满,这些页面按 insets.top 留白会多出一截。
  assert.match(
    layout.slice(chatSheet, layout.indexOf('/>', chatSheet)),
    /presentation:\s*'fullScreenModal'/,
  );
});

test('every page opened over the sheet has a chat-sheet route re-exporting its screen', () => {
  for (const [page, screen] of Object.entries(SHEET_PAGES)) {
    const route = read(`app/chat-sheet/${page}.tsx`);
    assert.match(route, new RegExp(`from '@/features/chat/screens/${screen}'`));
  }
});

test('full-chat fallbacks in use-chat-router point at existing routes', () => {
  const src = read('src/features/chat/chat-detail/hooks/use-chat-router.ts');
  assert.ok(src.includes("'/(chat)/location-picker'"), '/(chat)/location-picker missing from fullChatPath');
  assert.ok(fs.existsSync(path.join(root, 'app/(chat)/location-picker.tsx')), 'app/(chat)/location-picker.tsx does not exist');

  // 分享选择 / 转账压在聊天所在的 tab 栈上:CHAT_TABS 里每个 tab 都要镜像这两页。
  const tabsList = src.match(/const CHAT_TABS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(tabsList, 'CHAT_TABS missing from use-chat-router');
  const chatTabs = [...tabsList[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  for (const tab of chatTabs) {
    for (const page of ['share-picker', 'transfer-composer']) {
      const route = read(`app/(tabs)/${tab}/${page}.tsx`);
      assert.match(route, new RegExp(`from '@/features/chat/screens/${SHEET_PAGES[page]}'`), `app/(tabs)/${tab}/${page}.tsx`);
    }
  }

  // 有聊天页的 tab 都得在 CHAT_TABS 里,否则那里打开的选择页会退回消息栈,选完落在消息列表。
  const tabsWithChat = fs
    .readdirSync(path.join(root, 'app/(tabs)'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'app/(tabs)', entry.name, 'chat-detail.tsx')))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual([...chatTabs].sort(), tabsWithChat);
});

test('chat-detail never pushes the over-chat pages directly (they must go through pushOverChat)', () => {
  const dir = path.join(root, 'src/features/chat/chat-detail');
  const offenders = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx$/.test(entry.name) && entry.name !== 'use-chat-router.ts') {
        const text = fs.readFileSync(next, 'utf8');
        if (/['"`][^'"`]*\/(share-picker|transfer-composer|location-picker)['"`]/.test(text)) {
          offenders.push(path.relative(root, next));
        }
      }
    }
  };
  walk(dir);
  assert.deepEqual(offenders, [], 'direct pushes skip the sheet-aware routing and land under the sheet on iOS');
});
