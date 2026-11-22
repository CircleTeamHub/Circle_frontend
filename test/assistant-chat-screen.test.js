const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('the assistant wizard loads my circles even when opened from a circle', () => {
  const src = read('src/features/assistant/screens/AssistantChatScreen.tsx');
  const startWizard =
    src.match(/const startWizard = useCallback\([\s\S]*?\n  \);\n/)?.[0] ?? '';

  // 带圈子入口的文案允许「选择其他圈子」，选项必须包含用户自己的全部圈子。
  assert.match(startWizard, /askCircleWithContext/);
  assert.match(startWizard, /\n      void fetchMyCircles\(\);/);
  assert.doesNotMatch(startWizard, /if \(!data\.contextCircle\)/);
});

test('the assistant takes circle context only from an explicit route param', () => {
  const src = read('src/features/assistant/screens/AssistantChatScreen.tsx');

  // 广场的圈子筛选不是「从哪个圈子进来」:不能拿它当小助手的上下文。
  assert.doesNotMatch(src, /useDiscoverStore/);
  assert.match(src, /useLocalSearchParams<\{\s*contextCircleId\?: string;\s*\}>\(\)/);
  assert.match(src, /fetchAssistantBootstrap\(contextCircleId\)/);
});

test('a bootstrap that lands after the screen was left does not navigate', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/assistant/screens/AssistantChatScreen.tsx'),
    'utf8',
  );
  // 返回键弹掉页面后晚到的结果不能再 replace 当前栈顶。
  assert.match(source, /mountedRef\.current = false;/);
  assert.match(
    source,
    /\(data: AssistantBootstrapResponse\) => \{\s*if \(!mountedRef\.current\) return;[\s\S]*?router\.replace\(getAssistantChatHref/,
  );
});

test('the assistant header takes its own space instead of covering the first message', () => {
  const src = read('src/features/assistant/screens/AssistantChatScreen.tsx');
  // 悬浮头部约 140pt 高、绝对定位在列表上面,而列表只留 16pt 顶距:第一条消息被头像整个盖住。
  const headers = src.match(/<AssistantFloatingHeader[\s\S]*?\/>/g) ?? [];
  assert.equal(headers.length, 3);
  for (const header of headers) assert.match(header, /\binline\b/);
});

test('finishing setup confirms it before landing on the still-empty assistant chat', () => {
  const src = read('src/features/assistant/screens/AssistantChatScreen.tsx');
  const finishSetup =
    src.match(/const finishSetup = useCallback\([\s\S]*?\n  \);\n/)?.[0] ?? '';
  assert.match(finishSetup, /showTopNotice\(\{\s*type: 'success',\s*title: t\('assistant\.setupDoneTitle'/);
  assert.ok(
    finishSetup.indexOf('showTopNotice(') < finishSetup.indexOf('navigateToChat(bootstrap)'),
    'the confirmation is shown before navigating away',
  );
});
