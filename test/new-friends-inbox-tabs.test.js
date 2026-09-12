const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function flatten(value, prefix = '') {
  const out = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      Object.assign(out, flatten(child, full));
    } else {
      out[full] = child;
    }
  }
  return out;
}

// 「新的朋友」是两张收件箱：好友申请一张、我新加入的群聊一张。
test('the new-friends inbox splits friends and groups into two tabs', () => {
  const source = read('src/features/contacts/screens/NewFriendsScreen.tsx');

  assert.match(source, /InboxTabsHeader/);
  assert.match(source, /contacts\.friendActivity\.tabFriends/);
  assert.match(source, /contacts\.friendActivity\.tabGroups/);
  assert.match(source, /activeTab === 'groups' \? \(\s*<NewGroupsInboxList/);
  // 顶栏钉在列表外面：页签和搜索框跟着行一起滚走，等于没有分流。
  assert.doesNotMatch(source, /ListHeaderComponent/);
});

// 页签是页面的主分栏，不是一排筛选小药丸：两栏等宽、文字居中、选中靠字重。
test('the two tabs split the width evenly with centred labels', () => {
  const header = read('src/features/contacts/components/InboxTabsHeader.tsx');

  assert.match(header, /tab: \{\s*flex: 1,\s*alignItems: 'center',/);
  assert.match(header, /tabLabelActive/);
  assert.doesNotMatch(header, /FilterTabs/);
  // 搜索框是填充式胶囊，不是描边输入框。
  assert.match(header, /borderRadius: Radius\.pill/);
  assert.match(header, /backgroundColor: colors\.surfaceMuted/);
});

test('one search box filters whichever tab is showing', () => {
  const screen = read('src/features/contacts/screens/NewFriendsScreen.tsx');
  const list = read('src/features/contacts/components/NewGroupsInboxList.tsx');

  assert.match(screen, /contacts\.friendActivity\.searchPlaceholder/);
  assert.match(screen, /filterFriendInboxRows\(buildFriendActivityInboxRows\(activities\), query\)/);
  assert.match(screen, /<NewGroupsInboxList query=\{query\} \/>/);
  assert.match(list, /filterGroupChatRows\(/);
});

// 群组是群聊，不是圈子：这张表只能读会话列表，不能去拉圈子邀请。
test('the groups tab lists group chats, never circle invitations', () => {
  const list = read('src/features/contacts/components/NewGroupsInboxList.tsx');

  assert.match(list, /loadChatConversations/);
  assert.match(list, /selectGroupConversations/);
  assert.match(list, /getChatDetailHref\(\s*'contacts',/);
  assert.doesNotMatch(list, /fetchMyPendingVerifications|fetchMyApplications|circle-invitation/);
  assert.doesNotMatch(list, /verification\/\[id\]/);
});

// 两屏群聊列表共用会话 DTO 上这两个字段：入群时刻决定排序，在座人数上行。
test('the conversation DTO carries the join time and member count both screens need', () => {
  const protocol = read('src/chat-core/protocol.ts');
  const backendTypes = fs.readFileSync(
    path.join(process.cwd(), '..', 'circle_be', 'src', 'chat', 'chat.types.ts'),
    'utf8',
  );

  assert.match(protocol, /joinedAt\?: string \| null;/);
  assert.match(protocol, /memberCount\?: number \| null;/);
  assert.match(backendTypes, /joinedAt: string \| null;/);
  assert.match(backendTypes, /memberCount: number \| null;/);
});

test('the groups tab keeps the same load and refresh guards as the friends tab', () => {
  const list = read('src/features/contacts/components/NewGroupsInboxList.tsx');

  assert.match(list, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(list, /const handleRefreshGroups = useCallback/);
  assert.match(list, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(list, /mountedRef/);
  assert.match(list, /const isCancelled = \(\) =>[\s\S]{0,160}!mountedRef\.current/);
});

// 深链/推送直接落到子屏时，栈里没有上一级：返回键必须回上级页面，不能切 tab。
test('the back button pops the current stack instead of switching tabs', () => {
  const navHeader = read('src/components/ui/nav-header.tsx');
  const screen = read('src/features/contacts/screens/NewFriendsScreen.tsx');

  assert.match(navHeader, /const state = navigation\.getState\(\);/);
  assert.match(navHeader, /state\?\.type === 'stack' && \(state\.index \?\? 0\) > 0/);
  assert.match(navHeader, /canPopThisStack[\s\S]{0,120}fallbackHref/);
  assert.match(screen, /fallbackHref="\/\(tabs\)\/contacts"/);
});

test('every locale defines the new tab, search and group-inbox copy', () => {
  const keys = [
    'contacts.friendActivity.tabFriends',
    'contacts.friendActivity.tabGroups',
    'contacts.friendActivity.searchPlaceholder',
    'contacts.friendActivity.noMatches',
    'contacts.groupInbox.loading',
    'contacts.groupInbox.loadFailed',
    'contacts.groupInbox.empty',
    'contacts.groupInbox.joinedAt',
    'contacts.groupInbox.joined',
  ];

  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const flat = flatten(JSON.parse(read(`src/i18n/locales/${locale}.json`)));
    for (const key of keys) {
      assert.equal(typeof flat[key], 'string', `${locale} ${key}`);
      assert.notEqual(flat[key], '', `${locale} ${key}`);
    }
    assert.ok(
      flat['contacts.groupInbox.joinedAt'].includes('{{time}}'),
      `${locale} joinedAt needs {{time}}`,
    );
  }
});
