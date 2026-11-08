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
  const files = {
    '/(tabs)/messages/share-picker': 'app/(tabs)/messages/share-picker.tsx',
    '/(tabs)/messages/transfer-composer': 'app/(tabs)/messages/transfer-composer.tsx',
    '/(chat)/location-picker': 'app/(chat)/location-picker.tsx',
  };
  for (const [href, file] of Object.entries(files)) {
    assert.ok(src.includes(`'${href}'`), `${href} missing from FULL_CHAT_PATHS`);
    assert.ok(fs.existsSync(path.join(root, file)), `${file} does not exist`);
  }
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
