const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('messages screen renders pinned conversations as separated rounded surfaces without a pin icon', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /pinnedSurface/);
  assert.match(source, /item\.pinned \? \[s\.pinnedSurface, pinnedSurfaceStyle\] : null/);
  assert.match(source, /pinnedSurfaceStyle=\{d\.pinnedSurface\}/);
  assert.match(source, /borderRadius: Radius\.lg/);
  assert.doesNotMatch(source, /name="pin"/);
  assert.doesNotMatch(source, /leadingItem\?\.pinned \? null : <Divider \/>/);
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
  assert.match(screenSource, /accessibilityLabel="消息免打扰"/);
  assert.doesNotMatch(screenSource, /name="volume-mute-outline"/);
});

test('messages screen refreshes OpenIM conversations whenever it receives focus', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /useFocusEffect\(\s*useCallback\(\(\)\s*=>\s*\{/);
  assert.match(source, /setActiveFilterId\("all"\)/);
  assert.match(source, /loadConversationList\(\)\.catch/);
  assert.doesNotMatch(source, /hasFetchedRef/);
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
  assert.match(source, /await loadConversationList\(\)/);
  assert.match(source, /if \(mountedRef\.current\) setRefreshing\(false\)/);
  assert.match(source, /refreshing=\{refreshing\}/);
  assert.match(source, /onRefresh=\{handleRefreshConversations\}/);
});

test('messages screen exposes left-swipe conversation actions for read, hide, and delete', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/MessagesScreen.tsx',
  );
  const clientPath = path.join(process.cwd(), 'src/im/client.ts');
  const zhPath = path.join(process.cwd(), 'src/i18n/locales/zh.json');
  const source = fs.readFileSync(filePath, 'utf8');
  const clientSource = fs.readFileSync(clientPath, 'utf8');
  const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));

  assert.match(source, /PanResponder/);
  assert.match(source, /Animated\.View/);
  assert.match(source, /renderSwipeActions/);
  assert.match(source, /handleMarkConversationRead/);
  assert.match(source, /handleHideConversation/);
  assert.match(source, /handleConfirmDeleteConversation/);
  assert.match(source, /hideConversation\(conversation\.id\)/);
  assert.match(source, /deleteConversation\(conversation\.id\)/);
  assert.match(source, /Alert\.alert\(\s*t\("messages\.deleteChat"/);
  assert.match(clientSource, /export async function deleteConversation/);
  assert.match(clientSource, /OpenIMSDK\.deleteConversationAndDeleteAllMsg\(conversationID\)/);
  assert.equal(zh.messages.swipeMarkRead, '标记已读');
  assert.equal(zh.messages.swipeHide, '隐藏聊天');
  assert.equal(zh.messages.swipeDelete, '删除');
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
