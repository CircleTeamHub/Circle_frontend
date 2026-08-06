const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('messages screen renders pinned conversations as compact grouped surfaces without a pin icon', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /pinnedSurface/);
  assert.match(source, /type PinnedGroupPosition = "single" \| "first" \| "middle" \| "last" \| "none"/);
  assert.match(source, /getPinnedGroupPosition/);
  assert.match(source, /pinnedGroupPosition=\{getPinnedGroupPosition\(visibleConversations, index\)\}/);
  assert.match(source, /getPinnedRowStyle\(pinnedGroupPosition\)/);
  assert.match(source, /getPinnedSurfaceStyle\(pinnedGroupPosition\)/);
  assert.match(source, /pinnedSurfaceStyle=\{d\.pinnedSurface\}/);
  assert.match(source, /pinnedRowMiddle/);
  assert.match(source, /pinnedSurfaceMiddle/);
  assert.doesNotMatch(source, /name="pin"/);
  assert.match(source, /const hiddenPinnedSeparatorIDs = useMemo/);
  assert.match(source, /visibleConversations\[index \+ 1\]\?\.pinned/);
  assert.match(source, /hiddenPinnedSeparatorIDs\.has\(leadingItem\.id\) \? null : <Divider \/>/);
  assert.doesNotMatch(source, /trailingItem/);
  assert.match(source, /ItemSeparatorComponent=\{renderSeparator\}/);
});

test('messages screen darkens pinned conversation surfaces in light mode', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /resolvedMode/);
  assert.match(source, /resolvedMode === "light" \? colors\.surfaceBorder : colors\.surface/);
});

test('messages screen shows a muted indicator for conversations with notifications disabled', () => {
  const screenPath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const mapperPath = path.join(process.cwd(), 'src/im/mappers.ts');
  const typePath = path.join(process.cwd(), 'src/types/index.ts');
  const screenSource = fs.readFileSync(screenPath, 'utf8');
  const mapperSource = fs.readFileSync(mapperPath, 'utf8');
  const typeSource = fs.readFileSync(typePath, 'utf8');

  assert.match(typeSource, /muted: boolean/);
  assert.match(mapperSource, /muted: item\.recvMsgOpt !== 0/);
  assert.match(screenSource, /rowMeta:\s*\{[\s\S]{0,120}alignItems: "flex-end"[\s\S]{0,120}position: "relative"/);
  assert.match(screenSource, /mutedIndicator:\s*\{[\s\S]{0,160}position: "absolute"[\s\S]{0,160}top: 20[\s\S]{0,160}right: 0/);
  assert.match(screenSource, /item\.muted \? \(/);
  assert.match(screenSource, /<Text style=\{timeStyle\}>\{item\.time\}<\/Text>[\s\S]{0,240}name="notifications-off-outline"/);
  // The muted a11y label is now i18n'd; the Chinese survives as the defaultValue.
  assert.match(screenSource, /accessibilityLabel=\{t\("messages\.mutedA11y"/);
  assert.match(screenSource, /defaultValue: "消息免打扰"/);
  assert.doesNotMatch(screenSource, /name="volume-mute-outline"/);
});

test('messages screen reloads conversations on focus without resetting the active filter', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  // Reload-on-focus stays: groups created from群列表/圈子/临时群 must show up.
  assert.match(source, /useFocusEffect\(\s*useCallback\(\(\)\s*=>\s*\{/);
  assert.match(source, /loadChatConversations\(\)\.catch/);
  assert.doesNotMatch(source, /hasFetchedRef/);

  // Regression（返回丢失筛选）: 点私聊里的会话 → push chat-detail → 返回 refocus 列表，
  // 这个 focus effect 曾经把筛选强制重置回"全部"。焦点回来时不得再重置筛选。
  assert.doesNotMatch(source, /setActiveFilterId\("all"\)/);

  // 筛选仍由 Tab 栏驱动——只是去掉了 on-focus 的强制重置。
  assert.match(source, /setActiveFilterId\(filterItems\[index\]/);
});

test('messages screen supports pull-to-refresh for the conversation list', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(source, /handleRefreshConversations/);
  assert.match(source, /const mountedRef = useRef\(true\)/);
  assert.match(source, /mountedRef\.current = false/);
  assert.match(source, /refreshInFlightRef/);
  assert.match(source, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(source, /setRefreshing\(true\)/);
  assert.match(source, /await loadChatConversations\(\)/);
  assert.match(source, /if \(mountedRef\.current\) setRefreshing\(false\)/);
  assert.match(source, /refreshing=\{refreshing\}/);
  assert.match(source, /onRefresh=\{handleRefreshConversations\}/);
});

test('messages screen exposes left-swipe conversation actions for read, hide, and delete', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const zhPath = path.join(process.cwd(), 'src/i18n/locales/zh.json');
  const source = fs.readFileSync(filePath, 'utf8');
  const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));

  assert.match(source, /PanResponder/);
  assert.match(source, /Animated\.View/);
  assert.match(source, /renderSwipeActions/);
  assert.match(source, /handleMarkConversationRead/);
  assert.match(source, /handleHideConversation/);
  assert.match(source, /handleConfirmDeleteConversation/);
  // 自研栈:hide 与 delete 都走 preferences hidden(带本地清除的完整删除随详情页批次)。
  assert.match(source, /updateChatConversationPreferences\(conversation\.id, \{ hidden: true \}\)/);
  assert.match(source, /hidden: true,/);
  assert.match(source, /Alert\.alert\(\s*t\("messages\.deleteChat"/);
  assert.equal(zh.messages.swipeMarkRead, '标记已读');
  assert.equal(zh.messages.swipeHide, '隐藏聊天');
  assert.equal(zh.messages.swipeDelete, '删除');
});

test('messages screen counts local unread overrides before applying local badges', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const rawMappedConversations = useMemo/);
  assert.match(source, /applyLocalUnreadOverrides\(\s*rawMappedConversations,/);
  assert.match(
    source,
    /countLocalUnreadOverrides\(rawMappedConversations, localUnreadOverrides\)/,
  );
  assert.doesNotMatch(
    source,
    /countLocalUnreadOverrides\(conversations, localUnreadOverrides\)/,
  );
});

test('messages screen no longer exposes the notification bell entry', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /handleOpenNotifications/);
  assert.doesNotMatch(source, /["'`]\/\(tabs\)\/messages\/notifications["'`]/);
  assert.doesNotMatch(source, /name="notifications-outline"/);
  assert.doesNotMatch(source, /<Badge count=\{discoverUnread\} \/>/);
});

test('messages screen plus menu no longer exposes group management', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /"groupManagement"/);
  assert.doesNotMatch(source, /messages\.groupManagement/);
  assert.doesNotMatch(source, /router\.push\("\/\(tabs\)\/messages\/groups"\)/);
});
