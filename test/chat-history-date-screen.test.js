const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// 回归：日历日期网格必须是 7 等分列，且与星期表头列对齐。
// 旧实现用 flexWrap + `width: ${100/7}%`，因 RN 亚像素取整让 7 个格子累计略超 100%，
// 第 7 个（周六）被挤到下一行 → 每行只剩 6 格、周六列全空、7/4 起所有日期错位到左边一格。
// 用「每周一行 + 每格 flex:1」渲染，杜绝换行取整问题。
test('by-date calendar renders 7 equal flex columns (no flexWrap rounding)', () => {
  const screen = read('src/features/chat/screens/ChatHistoryDateScreen.tsx');

  // 不再依赖 flexWrap 换行来分列（这正是丢周六的根因）
  assert.doesNotMatch(screen, /flexWrap:\s*'wrap'/);
  // 不再用百分比宽度撑列
  assert.doesNotMatch(screen, /width:\s*`\$\{100 \/ CALENDAR_COLUMNS\}%`/);

  // 按周分行渲染
  assert.match(screen, /calendarWeeks/);
  assert.match(screen, /calendarWeeks\.map/);
  assert.match(screen, /weekRow:\s*\{[^}]*flexDirection:\s*'row'/);

  // 表头星期格与日期格都用 flex:1，保证 7 列等宽且上下对齐
  assert.match(screen, /weekdayCell:\s*\{[^}]*flex:\s*1/);
  assert.match(screen, /calendarCell:\s*\{[^}]*flex:\s*1/);
});

// 回归：按日期搜索必须把「当天 0 点」换算成【秒】再传给 OpenIM。
// OpenIM 的 searchTimePosition/searchTimePeriod 单位是秒（period 写成 24*60*60 即为证），
// 旧实现把 getTime()（毫秒）直接当 position → 落到 5 万年后的时间窗 → 永远搜不到记录。
test('by-date search converts day start to seconds for OpenIM searchTimePosition', () => {
  const client = read('src/im/client.ts');

  assert.match(client, /searchConversationMessagesByDate/);
  assert.match(client, /searchTimePosition:\s*Math\.floor\(startOfDay \/ 1000\)/);
  assert.match(client, /searchTimePeriod:\s*24 \* 60 \* 60/);
  // 不得再把毫秒时间戳直接当秒传
  assert.doesNotMatch(client, /searchTimePosition:\s*startOfDay\s*,/);
});

// 需求：有聊天记录的日子用颜色（圆点）标出来。
test('by-date calendar colors days that have chat records', () => {
  const screen = read('src/features/chat/screens/ChatHistoryDateScreen.tsx');

  // 翻到某月即拉取该月「有记录的日子」
  assert.match(screen, /getConversationMessageDays/);
  assert.match(screen, /recordDays/);
  // 有记录 → 该格渲染圆点
  assert.match(
    screen,
    /const hasRecords =\s*day\.isCurrentMonth && recordDays\.has\(day\.date\)/,
  );
  assert.match(screen, /s\.recordDot/);
  // 快速翻月的竞态防护：只应用最新月份的结果
  assert.match(screen, /recordsRequestRef\.current !== monthKey/);
  // 色觉不可依赖单一颜色 —— 有记录的日子加无障碍标签
  assert.match(screen, /chat\.history\.hasRecordsA11y/);
});

// 需求：点击日期进入「当天聊天记录」结果页（不再内联展示）。
test('by-date calendar navigates into the day results page on tap', () => {
  const screen = read('src/features/chat/screens/ChatHistoryDateScreen.tsx');

  assert.match(
    screen,
    /getChatHistoryDateResultsHref\(conversationID, sourceID, title, day\.date\)/,
  );
  // 相邻月份的日子：先翻月，不直接进结果页
  assert.match(screen, /if \(!day\.isCurrentMonth\)/);
  // 日历页本身不再内联搜索 / 渲染结果列表
  assert.doesNotMatch(screen, /searchConversationMessagesByDate/);
  assert.doesNotMatch(screen, /FlatList/);
});

test('day results screen searches the picked date and opens the message in chat', () => {
  const screen = read(
    'src/features/chat/screens/ChatHistoryDateResultsScreen.tsx',
  );

  assert.match(screen, /searchConversationMessagesByDate/);
  assert.match(screen, /formatChatHistoryDateTitle\(date\)/);
  assert.match(
    screen,
    /getChatDetailHref\('messages', sourceID, title, undefined, conversationID, clientMsgID\)/,
  );
  assert.match(screen, /chat\.history\.noRecordsForDate/);
  assert.match(screen, /onEndReached=\{handleLoadMore\}/);
});

test('day results page is registered as a route in the messages stack', () => {
  const route = read('app/(tabs)/messages/chat-history-date-results.tsx');
  assert.match(route, /ChatHistoryDateResultsScreen/);

  const layout = read('app/(tabs)/messages/_layout.tsx');
  assert.match(layout, /name="chat-history-date-results"/);

  const routes = read('src/features/user/utils/routes.ts');
  assert.match(routes, /export function getChatHistoryDateResultsHref/);
  assert.match(routes, /'\/\(tabs\)\/messages\/chat-history-date-results'/);
});
