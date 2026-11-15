const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 导航器一律不开 freezeOnBlur(10-23 为降发热开过,11-15 撤掉)。冻结靠 react-freeze 的
// Suspense,三周里出了三类问题:点 tab 停在上一页(RNS#4518,FE#354)、冻结边界无限提交卡死
// JS 线程(FE#376)、解冻时 React 把页面里的 layout effect 全部重跑 —— 「换账号 / 换 id 才
// 重置」的页面每次切 tab 回来都被清空(邀请页卡在转圈、备注输入被清),首渲慢检测误报
// (Sentry REACT-NATIVE-D2)。
// 看不见的页面不再重渲染的办法:订阅高频 store 的页面用 useStoreWhileActive + useScreenLive,
// 见 messages-screen.test.js。
test('no navigator layout freezes screens that are not visible', () => {
  const appDir = path.join(__dirname, '..', 'app');
  const layouts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === '_layout.tsx') layouts.push(full);
    }
  };
  walk(appDir);

  const navigators = layouts.filter((file) =>
    /<(Stack|Tabs)\b/.test(fs.readFileSync(file, 'utf8')),
  );
  assert.ok(navigators.length >= 5, 'expected the app stacks and tabs to be found');
  for (const file of navigators) {
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /freezeOnBlur|enableFreeze/,
      `${path.relative(path.join(__dirname, '..'), file)} must not freeze screens (see the note above)`,
    );
  }
});

// 没了冻结，切走的 tab、被压住的页面照样收 store 更新。整份会话列表每来一条消息就换一个新数组，
// 直接订阅它的页面看不见时也会跟着整表重算 —— 要经 useStoreWhileActive 只在活跃时订阅。
// 选择器（转发 / 分享 / 推荐好友）只在挑目标时打开、挑完就关，不算。
test('pages read the whole conversation list only while they are live', () => {
  const root = path.join(__dirname, '..');
  const pickers = new Set([
    'src/features/chat/screens/SharePickerScreen.tsx',
    'src/features/chat/screens/RecommendFriendScreen.tsx',
    'src/features/chat/components/chat-target-picker/use-chat-target-sources.ts',
  ]);
  const wholeList = /useChatStore\(\s*(?:selectConversations|\(?\s*([a-z]+)\s*\)?\s*=>\s*\1\.conversations\s*)\)/;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name)) {
        const file = path.relative(root, full);
        if (!pickers.has(file) && wholeList.test(fs.readFileSync(full, 'utf8'))) offenders.push(file);
      }
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'app'));
  assert.deepEqual(offenders, []);
});
