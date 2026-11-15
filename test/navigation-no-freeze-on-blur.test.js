const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

/** src/、app/ 和入口 index.ts 里的源码（不含测试）。 */
function sourceFiles() {
  const files = [path.join(root, 'index.ts')];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.(spec|test)\.[jt]sx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'app'));
  return files.filter((file) => fs.existsSync(file));
}

// 导航器一律不冻结看不见的页面(10-23 为降发热开过 freezeOnBlur,11-15 撤掉)。冻结靠 react-freeze 的
// Suspense,三周里出了三类问题:点 tab 停在上一页(RNS#4518,FE#354)、冻结边界无限提交卡死
// JS 线程(FE#376)、解冻时 React 把页面里的 layout effect 全部重跑 —— 「换账号 / 换 id 才
// 重置」的页面每次切 tab 回来都被清空(邀请页卡在转圈、备注输入被清),首渲慢检测误报
// (Sentry REACT-NATIVE-D2)。
// 看不见的页面不再重渲染的办法:订阅高频 store 的页面用 useStoreWhileActive + useScreenLive,
// 见 messages-screen.test.js。
test('nothing freezes screens that are not visible', () => {
  const freezing = /freezeOnBlur\s*[:=]\s*\{?\s*true|enableFreeze\s*\(|from\s+['"]react-freeze['"]/;
  const offenders = sourceFiles()
    .filter((file) => freezing.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file));
  assert.deepEqual(offenders, [], 'see the note above before freezing screens again');
});

// 没了冻结，切走的 tab、被压住的页面照样收 store 更新。整份会话列表每来一条消息就换一个新数组，
// 直接订阅它的页面看不见时也会跟着整表重算 —— 要经 useStoreWhileActive 只在活跃时订阅。
// 选择器（转发 / 分享 / 推荐好友）只在挑目标时打开、挑完就关，不算。
test('pages read the whole conversation list only while they are live', () => {
  const pickers = new Set([
    'src/features/chat/screens/SharePickerScreen.tsx',
    'src/features/chat/screens/RecommendFriendScreen.tsx',
    'src/features/chat/components/chat-target-picker/use-chat-target-sources.ts',
  ]);
  // selectConversations、(state) / (state: T) / state / ({ conversations }) => …conversations，可带尾逗号。
  const wholeList =
    /useChatStore\(\s*(?:selectConversations|(?:\([^()]*\)|\w+)\s*=>\s*(?:\w+\.)?conversations)\s*,?\s*\)/;
  const offenders = sourceFiles()
    .map((file) => path.relative(root, file))
    .filter((file) => !pickers.has(file) && wholeList.test(fs.readFileSync(path.join(root, file), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('the whole-list guard recognises the usual spellings', () => {
  const wholeList =
    /useChatStore\(\s*(?:selectConversations|(?:\([^()]*\)|\w+)\s*=>\s*(?:\w+\.)?conversations)\s*,?\s*\)/;
  for (const spelling of [
    'useChatStore(selectConversations)',
    'useChatStore((state) => state.conversations)',
    'useChatStore((s: ChatStoreState) => s.conversations)',
    'useChatStore(State => State.conversations)',
    'useChatStore(({ conversations }) => conversations)',
    'useChatStore(\n    (state) => state.conversations,\n  )',
  ]) {
    assert.match(spelling, wholeList, spelling);
  }
  for (const narrow of [
    'useChatStore((state) => state.conversations.find((c) => c.id === id))',
    'useChatStore((state) => state.conversationsSnapshotLoaded)',
    'useStoreWhileActive(useChatStore, selectConversations, live)',
  ]) {
    assert.doesNotMatch(narrow, wholeList, narrow);
  }
});
