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
  assert.match(source, /pinnedGroupPosition=\{getPinnedGroupPosition\(displayedConversations, index\)\}/);
  assert.match(source, /getPinnedRowStyle\(pinnedGroupPosition\)/);
  assert.match(source, /getPinnedSurfaceStyle\(pinnedGroupPosition\)/);
  assert.match(source, /pinnedSurfaceStyle=\{d\.pinnedSurface\}/);
  assert.match(source, /pinnedRowMiddle/);
  assert.match(source, /pinnedSurfaceMiddle/);
  assert.doesNotMatch(source, /name="pin"/);
  assert.match(source, /const hiddenPinnedSeparatorIDs = useMemo/);
  assert.match(source, /displayedConversations\[index \+ 1\]\?\.pinned/);
  assert.match(source, /hiddenPinnedSeparatorIDs\.has\(leadingItem\.id\) \? null : <Divider \/>/);
  assert.doesNotMatch(source, /trailingItem/);
  assert.match(source, /ItemSeparatorComponent=\{renderSeparator\}/);
});

test('messages screen keeps pinned conversation surfaces visually consistent', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /pinnedSurface:\s*\{\s*backgroundColor:\s*colors\.surface/);
  assert.doesNotMatch(source, /resolvedMode === "light" \? colors\.surfaceBorder : colors\.surface/);
});

test('messages screen distinguishes temporary chats with only an avatar clock badge', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/messages/screens/MessagesScreen.tsx'),
    'utf8',
  );

  assert.match(source, /item\.isTempChat/);
  assert.match(source, /<GroupChatAvatar/);
  assert.doesNotMatch(source, /tempChats\.listBadge/);
  assert.doesNotMatch(source, /tempChatExpiresAt/);
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
  assert.match(source, /setActiveFilterId\(filter\.id\)/);
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

test('messages screen exposes left-swipe conversation actions for pin, mute, and delete', () => {
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
  assert.match(source, /handleToggleConversationPinned/);
  assert.match(source, /handleToggleConversationMuted/);
  assert.match(source, /handleConfirmDeleteConversation/);
  assert.match(source, /pinned: !conversation\.pinned/);
  assert.match(source, /muted: !conversation\.muted/);
  assert.match(source, /await updateChatConversationPreferences\(conversation\.id, preference\)/);
  assert.match(source, /item\.pinned \? labels\.unpin : labels\.pin/);
  assert.match(source, /item\.muted \? labels\.unmute : labels\.mute/);
  // 删除仍保留原语义：清除本人历史后隐藏会话。
  assert.match(source, /hidden: true,/);
  assert.match(source, /Alert\.alert\(\s*t\("messages\.deleteChat"/);
  assert.equal(zh.messages.swipePin, '置顶');
  assert.equal(zh.messages.swipeUnpin, '取消置顶');
  assert.equal(zh.messages.swipeMute, '静音');
  assert.equal(zh.messages.swipeUnmute, '取消静音');
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
});

test('messages screen compacts only the tab gap and pins a standalone plus to the right', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /return orderMessageFilters\(\[\.\.\.BASE_FILTERS, \.\.\.customTabs\], filterOrder\);/,
  );
  assert.doesNotMatch(source, /filter\.id === "addGroup"/);
  assert.match(source, /filterRow: \{\s*position: "relative"/);
  assert.doesNotMatch(source, /filterTabs: \{/);
  assert.doesNotMatch(source, /filterTabsContent:/);
  assert.match(
    source,
    /addGroupButton: \{\s*position: "absolute",\s*top: 0,\s*right: 0,\s*zIndex: 1,\s*width: 32,/,
  );
  assert.match(source, /style=\{\[s\.addGroupButton, \{ backgroundColor: colors\.background \}\]\}/);
  assert.match(source, /addGroupIcon: \{\s*fontSize: 22,\s*lineHeight: 24,/);
  assert.match(source, /transform: \[\{ translateY: -2 \}\]/);
  assert.match(source, />＋<\/Text>/);
  assert.match(source, /router\.push\("\/\(tabs\)\/messages\/groups"\)/);
  assert.match(source, /onTabPress=\{handleFilterPress\}/);
  assert.match(source, /onTabPress=\{handleFilterPress\}\s*scrollable\s*compact/);

  const filterTabsSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/ui/filter-tabs.tsx'),
    'utf8',
  );
  assert.match(filterTabsSource, /rowCompact: \{\s*gap: 0/);
  assert.match(filterTabsSource, /paddingHorizontal: Spacing\.md/);
  assert.match(filterTabsSource, /tabCompact: \{\s*marginRight: -Spacing\.xs/);
  assert.match(filterTabsSource, /\.\.\.Typography\.caption/);
});

test('group management reorders built-in and custom message filters together', () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/messages/screens/GroupManagementScreen.tsx',
    ),
    'utf8',
  );

  assert.match(source, /id: 'all'.*builtIn: true/);
  assert.match(source, /id: 'private'.*builtIn: true/);
  assert.match(source, /id: `custom:\$\{group\.id\}`/);
  assert.match(source, /PanResponder\.create/);
  assert.match(source, /reorderMessageFilter/);
  assert.match(source, /setFilterOrder\(finalOrder\)/);
  assert.match(
    source,
    /scrollEnabled=\{!draggingFilterId && !draggingGroupId\}/,
  );
  assert.match(source, /displayGroups\.map\(\(group, index\)/);
  assert.match(source, /getGroupDragResponder\(group\.id\)/);
  assert.match(source, /reorderGroups\(groupIds\)/);
  assert.match(source, /transform: \[\{ translateY: groupDragY \}\]/);
});

test('new custom groups are pinned to the messages filters by default', () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/messages/screens/GroupManagementScreen.tsx',
    ),
    'utf8',
  );

  assert.match(source, /createGroup\(\{ name: trimmed, pinnedToTabs: true \}\)/);

});

test('group management lets users add group and direct chats to a custom group', () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/messages/screens/GroupManagementScreen.tsx',
    ),
    'utf8',
  );

  assert.match(source, /handleToggleMember\(activeGroup\.id, conversation\)/);
  assert.match(source, /await setMembers\(groupId, nextIDs\)/);
  assert.match(source, /messages\.groups\.groupChat/);
  assert.match(source, /messages\.groups\.directChat/);
  assert.match(source, /name=\{checked \? 'checkbox' : 'square-outline'\}/);
  assert.match(source, /<FlatList/);
  assert.match(source, /filterConversationMembers/);
  assert.match(source, /messages\.groups\.searchPlaceholder/);
  assert.match(source, /messages\.groups\.filterSelected/);
  assert.match(source, /handleToggleVisibleMembers/);
  assert.match(source, /initialNumToRender=\{12\}/);
  assert.doesNotMatch(source, /conversations\.map\(/);
  assert.match(source, /selected \? d\.groupRowSelected : null/);
  assert.match(source, /selected \? d\.rowLabelSelected : null/);
  assert.match(source, /accessibilityState=\{\{ selected \}\}/);
  assert.match(source, /backgroundColor: colors\.primaryLight/);
});
