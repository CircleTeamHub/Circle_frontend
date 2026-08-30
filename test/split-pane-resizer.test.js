const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 分栏分割线可拖拽的守卫。
//
// 这里最容易坏的不是拖拽本身，而是「两处宽度读同一个源」这件事：会话列表
// 与浮动 tab 条各自持有宽度的话，拖动时会当场错位。再就是夹取——存过的旧
// 宽度必须重新夹一遍，否则改了上下限之后老用户的窗口会被挤坏。
const read = (relative) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

test('pane width bounds keep both panes usable', () => {
  const source = read('src/hooks/use-desktop-split-layout.ts');
  const pick = (name) =>
    Number(new RegExp(`${name} = (\\d+)`).exec(source)?.[1]);

  const min = pick('SPLIT_LIST_PANE_MIN_WIDTH');
  const max = pick('SPLIT_LIST_PANE_MAX_WIDTH');
  const fallback = pick('SPLIT_LIST_PANE_WIDTH');
  const splitAt = pick('DESKTOP_SPLIT_MIN_WIDTH');

  assert.ok(min > 0 && max > min, '上下限必须成立');
  assert.ok(fallback >= min && fallback <= max, '默认宽度要落在可拖区间内');
  // 拖到最宽时，触发分栏的最小窗口下右栏仍得留出能用的聊天区。
  assert.ok(
    splitAt - max >= 320,
    '左栏拖到上限后右栏不足 320，聊天区会被挤扁',
  );
});

test('the store clamps both fresh and previously persisted widths', () => {
  const source = read('src/stores/splitPaneStore.ts');

  assert.match(source, /export function clampListPaneWidth/);
  assert.match(source, /SPLIT_LIST_PANE_MIN_WIDTH/);
  assert.match(source, /SPLIT_LIST_PANE_MAX_WIDTH/);
  assert.match(source, /setListPaneWidth: \(width\) =>\s*set\(\{ listPaneWidth: clampListPaneWidth\(width\) \}\)/);
  // 旧值回灌时也要过夹取，否则改上下限会把老用户坑住。
  assert.match(source, /merge:/);
  assert.match(source, /clampListPaneWidth\(\s*saved\?\.listPaneWidth/);
  assert.match(source, /persist\(/);
});

test('list pane and floating tab bar read the same width source', () => {
  const messages = read('src/features/messages/screens/MessagesScreen.tsx');
  const tabs = read('app/(tabs)/_layout.tsx');

  for (const source of [messages, tabs]) {
    assert.match(source, /useSplitPaneStore\(\(state\) => state\.listPaneWidth\)/);
    // 不允许任何一侧退回写死的默认宽度常量，那会在拖动时当场错位。
    assert.doesNotMatch(source, /width: SPLIT_LIST_PANE_WIDTH/);
  }
  assert.match(messages, /<SplitPaneResizer paneWidth=\{listPaneWidth\}/);
});

test('the resizer keeps its pan handlers intact', () => {
  const source = read('src/components/app/split-pane-resizer.tsx');

  assert.match(source, /\{\.\.\.panResponder\.panHandlers\}/);
  // 曾经在展开 panHandlers 之后又写了一个 onStartShouldSetResponder={() => false}，
  // 把手势授予覆盖成永不响应 —— 分割线看得见却拖不动。别再犯。
  assert.doesNotMatch(
    source,
    /panHandlers\}[\s\S]{0,400}onStartShouldSetResponder/,
    'panHandlers 之后不得再声明 onStartShouldSetResponder，会覆盖掉手势授予',
  );
  assert.match(source, /cursor: 'col-resize'/);

  // 拖不动的第二个真因：把 paneWidth 写进 responder 的 useMemo 依赖。
  // 拖动第一帧宽度就变 → responder 整个重建 → 进行中的手势失去响应者，
  // 表现为"按住只能拖一下就断"。responder 只许读 ref。
  const memoDeps = /PanResponder\.create\([\s\S]*?\),\s*\/\/[^\n]*\n\s*\[([^\]]*)\]/.exec(source);
  assert.ok(memoDeps, '找不到 responder 的 useMemo 依赖数组');
  assert.doesNotMatch(
    memoDeps[1],
    /paneWidth/,
    'responder 的依赖里出现 paneWidth：拖动第一帧就会重建 responder，手势会断',
  );
  assert.match(source, /paneWidthRef\.current/);
  // 拖出热区后不许被祖先抢走手势。
  assert.match(source, /onPanResponderTerminationRequest: \(\) => false/);
});

test('the resizer is keyboard reachable and exposes its current range', () => {
  const source = read('src/components/app/split-pane-resizer.tsx');

  assert.match(source, /Platform\.OS === 'web'[\s\S]*?tabIndex: 0/);
  assert.match(source, /onKeyDown:/);
  assert.match(source, /key === 'ArrowLeft'/);
  assert.match(source, /key === 'ArrowRight'/);
  assert.match(source, /key === 'Home'/);
  assert.match(source, /key === 'End'/);
  assert.match(source, /key === 'Enter' \|\| key === ' '/);
  assert.match(source, /accessibilityValue=\{\{/);
  assert.match(source, /min: SPLIT_LIST_PANE_MIN_WIDTH/);
  assert.match(source, /max: SPLIT_LIST_PANE_MAX_WIDTH/);
  assert.match(source, /now: clampListPaneWidth\(paneWidth\)/);
  assert.match(source, /active \|\| hovered \|\| focused/);
});
