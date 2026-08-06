const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 契约随自研栈迁移更新(意图不变):会话事实源从 OpenIM imStore 换成 chat-core
// store(ChatConversationDto),置顶/免打扰走 updateChatConversationPreferences;
// 阅后即焚与清空聊天记录在自研栈无后端支持,UI 整块删除(不留假开关)。
test('chat info screen uses real conversation state instead of local placeholder toggles', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /useChatStore\(\(state\) => state\.conversations\)/);
  assert.doesNotMatch(source, /useIMStore/);
  assert.doesNotMatch(source, /@\/im\//);
  assert.doesNotMatch(source, /@openim\/rn-client-sdk/);
  assert.match(
    source,
    /conversations?\.find\(\s*\(\s*conversation\s*\)\s*=>\s*conversation\.id\s*===\s*conversationID\s*\)/,
  );
  assert.match(source, /const routeSourceID = friendId;/);
  assert.match(
    source,
    /conversations?\.find\(\s*\(\s*conversation\s*\)\s*=>[\s\S]{0,120}conversation\.peer\?\.id\s*===\s*routeSourceID\s*\|\|\s*conversation\.circleId\s*===\s*routeSourceID[\s\S]{0,40}\)/,
  );
  assert.doesNotMatch(source, /conversation\.sourceID\s*===\s*routeSourceID/);
  // 群聊从圈子详情等入口进来时 store 可能还没有该会话:get-or-create 结果兜底。
  assert.match(source, /const activeConversation = conversation \?\? groupConversation;/);
  assert.match(source, /const resolvedConversationID = activeConversation\?\.id \?\? '';/);
  assert.match(source, /conversationID/);
  assert.match(source, /const basePinned = activeConversation\?\.pinned \?\? false;/);
  assert.match(source, /const baseMuted = activeConversation\?\.muted \?\? false;/);
  assert.match(source, /toggleValue={[^}]*pinned[^}]*}/);
  assert.match(source, /toggleValue={[^}]*muted[^}]*}/);
  assert.match(source, /const handleTogglePinned = useCallback/);
  assert.match(
    source,
    /updateChatConversationPreferences\(resolvedConversationID,\s*\{\s*pinned:\s*nextPinned\s*\}\)/,
  );
  assert.match(source, /const handleToggleMuted = useCallback/);
  assert.match(
    source,
    /updateChatConversationPreferences\(resolvedConversationID,\s*\{\s*muted:\s*nextMuted\s*\}\)/,
  );
  assert.match(
    source,
    /if \(nextMuted\) \{\s*Alert\.alert\(t\('chat\.messagesThatNotify'\),\s*t\('chat\.messagesThatNotifyHint'\)\);/s,
  );
  assert.doesNotMatch(source, /buildChatInfoState/);
  assert.doesNotMatch(source, /toggleConversationPinned/);
  assert.doesNotMatch(source, /setConversationMute/);
  assert.doesNotMatch(source, /setConversationBurnDuration/);
  assert.doesNotMatch(source, /clearConversationMessages/);
  assert.doesNotMatch(source, /burnDuration/);
  assert.doesNotMatch(source, /const \[pinChat, setPinChat\] = useState\(false\)/);
  assert.doesNotMatch(source, /const \[muteNotifications, setMuteNotifications\] = useState\(false\)/);
  assert.doesNotMatch(source, /toggleValue={pinChat}/);
  assert.doesNotMatch(source, /toggleValue={muteNotifications}/);
});

test('chat info screen renders compact unified display icons', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /UserIconRow/);
  assert.match(source, /compact/);
  assert.match(source, /displayIcons/);
});

test('chat info screen renders a dedicated group info layout for group conversations', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /isGroupConversation/);
  // 契约随自研栈迁移更新(意图不变):群信息=圈子详情,成员目录=会话成员表。
  assert.match(source, /createCircleChatConversation\(groupID\)/);
  assert.match(source, /fetchChatMembers\(conversationDto\.id\)/);
  assert.match(source, /fetchCircleDetail\(groupID\)/);
  assert.match(source, /const GROUP_MEMBER_COLUMNS = 5/);
  assert.match(source, /const COLLAPSED_GROUP_MEMBER_ROWS = 4/);
  assert.match(
    source,
    /const collapsedGroupMemberLimit =\s*GROUP_MEMBER_COLUMNS \* COLLAPSED_GROUP_MEMBER_ROWS - \(canManageGroup \? 1 : 0\)/,
  );
  assert.match(source, /groupMembers\.slice\(0,\s*collapsedGroupMemberLimit\)/);
  assert.match(source, /groupMembers\.length > collapsedGroupMemberLimit/);
  assert.match(source, /groupMemberGrid/);
  assert.match(source, /title=\{t\('chat\.groupInfoWithCount',\s*\{\s*count: memberCount\s*\}\)\}/);
  assert.doesNotMatch(source, /style=\{s\.groupHeader\}/);
  assert.doesNotMatch(source, /s\.groupHeaderName/);
  assert.doesNotMatch(source, /s\.groupHeaderMeta/);
  assert.doesNotMatch(source, /t\('chat\.groupMembersCount',\s*\{\s*count: memberCount\s*\}\)/);
  assert.match(source, /groupNameText/);
  assert.match(source, /t\('chat\.groupName'\)/);
  assert.match(source, /t\('chat\.groupNotice'\)/);
  assert.match(source, /t\('chat\.searchHistory'\)/);
  assert.match(source, /t\('chat\.moreGroupMembers'/);
  assert.match(source, /rightIcon=\{canViewMemberDirectory \? 'search-outline' : undefined\}/);
  assert.match(source, /onRightPress=\{canViewMemberDirectory \? handleOpenSearchGroupMembers : undefined\}/);
  assert.match(source, /getGroupMemberSearchHref/);
});

// 契约随自研栈迁移更新(意图不变):成员昵称/头像以 fetchChatMembers 返回为准
// (后端即事实源),不再需要 OpenIM 时代的逐成员 profile 二次刷新。
test('chat info screen serves the member directory straight from chat-core members', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /fetchUserProfile/);
  assert.doesNotMatch(source, /refreshGroupMemberProfiles/);
  assert.doesNotMatch(source, /fromImUserId/);
  // review R2：权限走活体 hook；目录只有 canViewMemberDirectory=true 才拉，
  // 撤权时 focus 回调重跑并清空目录。
  assert.match(source, /useGroupMemberViewAccess\(\{/);
  assert.match(source, /if \(!canViewMemberDirectory\) \{\s*\n\s*setGroupMembers\(\[\]\);\s*\n\s*return;/);
  assert.match(source, /const members = await fetchChatMembers\(conversationDto\.id\);/);
  assert.match(source, /uri=\{member\.avatarUrl \?\? undefined\}/);
});

test('chat info screen keeps member access live while mounted', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  // 自己的角色来自订阅驱动的 selfMember——群主撤权时 canManageGroup /
  // canViewMemberDirectory 立即翻转，不等重新聚焦。
  assert.match(source, /selfMember: currentGroupMember,/);
  assert.match(source, /canViewMembers: canViewMemberDirectory,/);
  assert.match(source, /revalidate: revalidateMemberAccess,/);
  assert.doesNotMatch(source, /setCurrentGroupMember/);
  // 打开成员资料前 fail-closed 现场重查。
  assert.match(source, /if \(!\(await revalidateMemberAccess\(\)\)\) \{\s*\n\s*return;/);
});

test('chat info screen lets the current user open their own profile from the group member grid', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const handleOpenMemberProfile = useCallback/);
  // 群成员 → profile 必须按本屏所在 tab 栈(originScope=scope)推断，chat-info 在
  // messages/contacts/discover/profile 都有 re-export；写死 'messages' 会把 profile
  // 推进 messages 栈、串栈污染(与 AddFriend 同类 bug)。
  // 契约随自研栈迁移更新(意图不变):id 已是后端 UUID,无需 fromImUserId 转换。
  assert.match(source, /router\.push\(getUserProfileHref\(scope,\s*member\.userId/);
  assert.doesNotMatch(source, /getUserProfileHref\(\s*['"]messages['"]/);
  assert.doesNotMatch(
    source,
    /handleOpenMemberProfile[\s\S]{0,160}member\.userId === currentUserID/,
  );
});

test('chat info screen gives group rows real actions instead of unsupported placeholders', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /title=\{t\('chat\.groupInfoWithCount',\s*\{\s*count: memberCount\s*\}\)\}/);
  assert.match(source, /handleEditGroupName/);
  // 契约随自研栈迁移更新(意图不变):群名即圈子名,改名走 updateCircle。
  assert.match(source, /updateCircle\(groupID,\s*\{\s*name:\s*trimmed\s*\}\)/);
  assert.match(source, /handleEditGroupNotice/);
  assert.match(source, /getEditGroupNoticeHref/);
  assert.doesNotMatch(source, /updateGroupNotice\(groupID,\s*trimmed\)/);
  // 「我的群内昵称」在自研栈无后端支持:整块 UI 已删除,不留假开关。
  assert.doesNotMatch(source, /handleEditMyGroupAlias/);
  assert.doesNotMatch(source, /updateGroupMemberAlias/);
  assert.doesNotMatch(source, /chat\.myAliasInGroup/);
  assert.doesNotMatch(source, /handleMinimizeGroupChat/);
  assert.doesNotMatch(source, /hideConversation\(resolvedConversationID\)/);
  assert.doesNotMatch(source, /label=\{t\('chat\.minimizeChat'\)\}/);
  assert.doesNotMatch(source, /handleSaveGroupToContacts/);
  assert.doesNotMatch(source, /saveGroupToContacts/);
  assert.doesNotMatch(source, /chat\.saveToContacts/);
  assert.doesNotMatch(source, /handleResetGroupNotifyMessages/);
  assert.doesNotMatch(source, /resetConversationGroupAtType/);
  assert.doesNotMatch(source, /label=\{t\('chat\.messagesThatNotify'\)\}/);
  assert.doesNotMatch(source, /subtitle=\{t\('chat\.messagesThatNotifyHint'\)\}/);
  assert.match(source, /handleOpenGroupReport/);
  assert.match(source, /groupID/);
  assert.doesNotMatch(source, /handleOpenUnsupportedGroupAction/);
});

test('chat info screen always shows group member nicknames without a toggle', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /showOnScreenNames/);
  assert.doesNotMatch(source, /setShowOnScreenNames/);
  assert.doesNotMatch(source, /savedShowOnScreenNames/);
  assert.doesNotMatch(source, /chat\.onScreenNames/);
});

test('chat info screen opens a dedicated group notice editor route', () => {
  const infoPath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const routeHelperPath = path.join(process.cwd(), 'src/features/user/utils/routes.ts');
  const routeFiles = [
    'app/(tabs)/messages/edit-group-notice.tsx',
    'app/(tabs)/contacts/edit-group-notice.tsx',
    'app/(tabs)/discover/edit-group-notice.tsx',
    'app/(tabs)/profile/edit-group-notice.tsx',
  ];
  const infoSource = fs.readFileSync(infoPath, 'utf8');
  const routeSource = fs.readFileSync(routeHelperPath, 'utf8');

  assert.match(infoSource, /router\.push\(\s*getEditGroupNoticeHref\(scope,/);
  assert.match(infoSource, /groupID/);
  assert.match(infoSource, /groupTitle/);
  assert.match(infoSource, /groupNotice/);
  assert.doesNotMatch(infoSource, /promptForText\(\s*t\('chat\.groupNotice'\)/);
  assert.match(routeSource, /function getEditGroupNoticeHref/);
  assert.match(routeSource, /edit-group-notice/);
  for (const relativePath of routeFiles) {
    assert.equal(fs.existsSync(path.join(process.cwd(), relativePath)), true);
  }
});

test('chat info screen uses the shared primary switch color for group toggles', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /trackColor=\{\{ false: colors\.surfaceBorder, true: colors\.primary \}\}/);
  assert.doesNotMatch(source, /trackColor=\{\{ false: colors\.surfaceBorder, true: colors\.success \}\}/);
});

// 契约随自研栈迁移更新(意图不变):群公告即圈子简介,保存走 updateCircle。
test('group notice editor screen updates the circle description and returns', () => {
  const screenPath = path.join(process.cwd(), 'src/features/chat/screens/EditGroupNoticeScreen.tsx');
  const source = fs.readFileSync(screenPath, 'utf8');

  assert.match(source, /useLocalSearchParams/);
  assert.match(source, /TextInput/);
  assert.match(source, /multiline/);
  assert.match(source, /updateCircle\(groupID,\s*\{\s*description:\s*nextNotice\s*\}\)/);
  assert.doesNotMatch(source, /@\/im\//);
  assert.match(source, /router\.back\(\)/);
  assert.match(source, /NavHeader/);
});

// 契约随自研栈迁移更新(意图不变):自研栈无临时建群/临时邀请——「加群成员」
// = 邀请好友进圈(担保邀请流程),两张临时屏与其路由注册已删除。
test('chat info screen routes the add-member entry to the circle invite flow', () => {
  const infoPath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const routePath = path.join(process.cwd(), 'app/(tabs)/messages/invite-group-members.tsx');
  const newGroupRoutePath = path.join(process.cwd(), 'app/(tabs)/messages/new-group.tsx');
  const layoutPath = path.join(process.cwd(), 'app/(tabs)/messages/_layout.tsx');
  const screenPath = path.join(process.cwd(), 'src/features/messages/screens/InviteGroupMembersScreen.tsx');
  const newGroupScreenPath = path.join(process.cwd(), 'src/features/messages/screens/NewGroupScreen.tsx');
  const infoSource = fs.readFileSync(infoPath, 'utf8');
  const layoutSource = fs.readFileSync(layoutPath, 'utf8');

  assert.match(infoSource, /handleOpenInviteGroupMembers/);
  assert.match(infoSource, /getCircleInviteFriendsHref\(/);
  assert.doesNotMatch(infoSource, /invite-group-members/);
  assert.match(infoSource, /groupID/);
  assert.match(infoSource, /groupTitle/);
  assert.doesNotMatch(infoSource, /promptForText\(t\('chat\.addGroupMember'\)/);
  assert.doesNotMatch(layoutSource, /invite-group-members/);
  assert.doesNotMatch(layoutSource, /"new-group"/);
  assert.equal(fs.existsSync(routePath), false);
  assert.equal(fs.existsSync(newGroupRoutePath), false);
  assert.equal(fs.existsSync(screenPath), false);
  assert.equal(fs.existsSync(newGroupScreenPath), false);
});

test('chat info screen right search opens group member search instead of chat history', () => {
  const infoPath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const routeHelperPath = path.join(process.cwd(), 'src/features/user/utils/routes.ts');
  const routeFiles = [
    'app/(tabs)/messages/search-group-members.tsx',
    'app/(tabs)/contacts/search-group-members.tsx',
    'app/(tabs)/discover/search-group-members.tsx',
    'app/(tabs)/profile/search-group-members.tsx',
  ];
  const infoSource = fs.readFileSync(infoPath, 'utf8');
  const routeSource = fs.readFileSync(routeHelperPath, 'utf8');

  assert.match(infoSource, /const handleOpenSearchGroupMembers = useCallback/);
  assert.match(infoSource, /router\.push\(\s*getGroupMemberSearchHref\(scope,/);
  assert.match(infoSource, /onRightPress=\{canViewMemberDirectory \? handleOpenSearchGroupMembers : undefined\}/);
  assert.doesNotMatch(infoSource, /onRightPress=\{handleOpenSearchHistory\}/);
  assert.match(routeSource, /function getGroupMemberSearchHref/);
  assert.match(routeSource, /search-group-members/);
  for (const relativePath of routeFiles) {
    assert.equal(fs.existsSync(path.join(process.cwd(), relativePath)), true);
  }
});

test('group member search screen loads and filters group members', () => {
  const screenPath = path.join(process.cwd(), 'src/features/chat/screens/SearchGroupMembersScreen.tsx');
  const source = fs.readFileSync(screenPath, 'utf8');

  assert.match(source, /createCircleChatConversation\(groupID\)/);
  assert.match(source, /fetchChatMembers\(conversation\.id\)/);
  assert.match(source, /member\.nickname\.toLowerCase\(\)\.includes\(trimmedQuery\)/);
  assert.match(source, /member\.userId\.toLowerCase\(\)\.includes\(trimmedQuery\)/);
  assert.match(source, /getUserProfileHref\(scope,/);
  assert.match(source, /member\.userId, member\.nickname/);
  assert.doesNotMatch(source, /fromImUserId\(item\.userID\)/);
  assert.doesNotMatch(source, /rowSubtitle/);
  assert.match(source, /t\('chat\.searchGroupMembers'\)/);
});

test('group member search keeps authorization live and revalidates before opening profiles', () => {
  const screenPath = path.join(process.cwd(), 'src/features/chat/screens/SearchGroupMembersScreen.tsx');
  const source = fs.readFileSync(screenPath, 'utf8');

  // review R2 P1：authorized 来自活体 hook（订阅角色变化），撤权即清结果；
  // 点开成员资料前还要 fail-closed 现场重查。
  assert.match(source, /useGroupMemberViewAccess\(\{/);
  assert.match(source, /canViewMembers: authorized,/);
  assert.match(source, /if \(!authorized\) \{\s*\n\s*setMembers\(\[\]\);/);
  assert.match(source, /if \(!\(await revalidate\(\)\)\) \{\s*\n\s*return;/);
});

// 契约随自研栈迁移更新(意图不变):踢人/退群的事实源就是业务后端本身,
// OpenIM 双写与 result.handled 回落链路已删——单一调用成功即生效。
test('group member mutations go straight to the backend without an OpenIM fallback', () => {
  const infoPath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const apiPath = path.join(process.cwd(), 'src/services/api/groups.ts');
  const infoSource = fs.readFileSync(infoPath, 'utf8');
  const apiSource = fs.readFileSync(apiPath, 'utf8');

  assert.match(apiSource, /function leaveGroup/);
  assert.match(apiSource, /`\/group\/\$\{groupID\}\/leave`/);
  assert.match(apiSource, /function removeGroupMember/);
  assert.match(apiSource, /`\/group\/\$\{groupID\}\/members\/\$\{userID\}`/);

  assert.match(infoSource, /leaveGroup\(groupID\)/);
  assert.doesNotMatch(infoSource, /leaveGroupChat/);
  assert.match(infoSource, /removeGroupMember\(groupID,\s*member\.userId\)/);
  assert.doesNotMatch(infoSource, /kickGroupMembers/);
  assert.doesNotMatch(infoSource, /result\.handled/);
});


test('non-chat filesystem features keep deferring native filesystem loading', () => {
  const uploadSource = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/upload.ts'),
    'utf8',
  );

  assert.doesNotMatch(
    uploadSource,
    /^import\s+(?!type\b)[^\n]*from\s+['"]react-native-fs['"]/m,
  );
  assert.doesNotMatch(uploadSource, /import\(['"]react-native-fs['"]\)/);
  assert.match(uploadSource, /require\(['"]react-native-fs['"]\)/);
  assert.match(uploadSource, /function loadNativeFS/);
  assert.match(uploadSource, /stopUpload/);
  assert.match(uploadSource, /expo-file-system\/legacy/);

  const checkedFiles = ['src/services/cache/clear-app-cache.ts'];

  for (const relativePath of checkedFiles) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

    assert.doesNotMatch(source, /import\s+RNFS\s+from\s+['"]react-native-fs['"]/);
    // 延迟加载即可，机制不限：动态 import() 或函数内 require() 都满足
    // “不要在模块顶层 eager 加载原生 fs”这一目标（Web/SSR 渲染时不触达原生模块）。
    assert.match(source, /(?:import|require)\('react-native-fs'\)/);
    assert.match(source, /loadNativeFS/);
  }
});

test('i18n avoids synchronous storage reads during web server rendering', () => {
  const filePath = path.join(process.cwd(), 'src/i18n/index.ts');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /function canUseSynchronousStorage\(\)/);
  assert.match(source, /typeof window !== 'undefined'/);
  assert.match(source, /if \(!canUseSynchronousStorage\(\)\) \{\s*return getDeviceLanguage\(\);\s*\}/s);
  assert.match(source, /if \(canUseSynchronousStorage\(\)\) \{\s*storage\.set\(LANGUAGE_KEY, lang\);/s);
  assert.match(source, /if \(!canUseSynchronousStorage\(\)\) \{\s*return;\s*\}/s);
});

test('i18n defaults to following the system language when no preference is saved', () => {
  const filePath = path.join(process.cwd(), 'src/i18n/index.ts');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /export const APP_LANGUAGE_OPTIONS/);
  for (const lang of ['zh', 'en', 'ja', 'ko', 'es']) {
    assert.match(source, new RegExp(`value:\\s*'${lang}'`));
    assert.match(source, new RegExp(`resources[\\s\\S]*${lang}:\\s*\\{\\s*translation:\\s*${lang}\\s*\\}`));
  }
  assert.match(source, /export type AppLanguagePreference = 'system' \| AppLanguage/);
  assert.match(source, /function getSavedLanguagePreference\(\): AppLanguagePreference/);
  assert.match(source, /if \(isAppLanguage\(saved\)\) return saved;/);
  assert.match(source, /return 'system';/);
  assert.match(source, /export function getCurrentLanguagePreference\(\): AppLanguagePreference/);
  assert.match(source, /export function setLanguage\(lang: AppLanguagePreference\)/);
  assert.match(source, /if \(lang === 'system'\) \{[\s\S]*storage\.remove\(LANGUAGE_KEY\);[\s\S]*i18n\.changeLanguage\(getDeviceLanguage\(\)\);[\s\S]*return;/);
});

test('note block editor defers DOM editor imports during web server rendering', () => {
  const filePath = path.join(process.cwd(), 'src/features/notes/components/NoteBlockEditor.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /import\s+NoteBlockEditorDOM\s+from/);
  assert.match(source, /function canLoadDOMEditor\(\)/);
  assert.match(source, /Platform\.OS !== 'web' \|\| typeof window !== 'undefined'/);
  assert.match(source, /require\('@\/features\/notes\/dom\/NoteBlockEditor\.dom'\)/);
  assert.match(source, /if \(!canLoadDOMEditor\(\)\) \{\s*return <View style=\{s\.container\} \/>;\s*\}/s);
});

// 契约随自研栈迁移更新(意图不变):pin/mute 仍走 pending 守卫;阅后即焚与
// 清空聊天记录在自研栈无后端支持,相关词条/开关必须整块消失(不留假开关)。
test('chat info screen constrains conversation actions with pending guards', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /t\('chat\.pending'\)/);
  assert.match(source, /pin: false,\s*mute: false,\s*\}/s);
  assert.match(source, /actionPending\.pin \? undefined : handleTogglePinned/);
  assert.match(source, /actionPending\.mute \? undefined : handleToggleMuted/);
  assert.match(source, /hasToggle={!actionPending\.pin}/);
  assert.match(source, /hasToggle={!actionPending\.mute}/);
  assert.doesNotMatch(source, /burnDurationOptions/);
  assert.doesNotMatch(source, /chat\.burnMessage/);
  assert.doesNotMatch(source, /chat\.selectBurnTime/);
  assert.doesNotMatch(source, /handleOpenBurnDurationPicker/);
  assert.doesNotMatch(source, /handleConfirmClearHistory/);
  assert.doesNotMatch(source, /chat\.clearHistoryWarning/);
  assert.doesNotMatch(source, /actionPending\.burn/);
  assert.doesNotMatch(source, /actionPending\.clear/);
});

test('chat info screen reconciles optimistic conversation state after live updates catch up', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const hasOptimisticConversationState =/);
  assert.match(source, /useEffect\(\(\) => \{/);
  assert.match(source, /if \(!hasOptimisticConversationState\) \{/);
  assert.match(source, /const nextState = \{ \.\.\.current \};/);
  // 契约随自研栈迁移更新(意图不变):基线值来自 chat-core 会话 dto 的
  // pinned/muted 布尔,不再经 buildChatInfoState 换算。
  assert.match(source, /if \(current\.pinned !== undefined && current\.pinned === basePinned\) \{/);
  assert.match(source, /delete nextState\.pinned;/);
  assert.match(source, /if \(current\.muted !== undefined && current\.muted === baseMuted\) \{/);
  assert.match(source, /delete nextState\.muted;/);
  assert.match(source, /return nextState;/);
});

test('chat info screen applies optimistic pin and mute updates only after the ref-based guard claims the action', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const runConversationAction = useCallback/);
  assert.match(source, /setConversationActionPending\(action, true\);[\s\S]{0,120}await task\(\);/);
  // 契约随自研栈迁移更新(意图不变):task 换成 updateChatConversationPreferences
  // 后正文更长,窗口放宽,守卫顺序断言不变。
  assert.match(
    source,
    /void runConversationAction\(\s*'pin',[\s\S]{0,240}setOptimisticConversationState\(\(current\) => \(\{/,
  );
  assert.match(
    source,
    /void runConversationAction\(\s*'mute',[\s\S]{0,400}setOptimisticConversationState\(\(current\) => \(\{/,
  );
  assert.doesNotMatch(
    source,
    /const previousPinned = pinned;[\s\S]{0,120}setOptimisticConversationState\(\(current\) => \(\{[\s\S]{0,80}pinned: nextPinned/,
  );
  assert.doesNotMatch(
    source,
    /const previousMuted = muted;[\s\S]{0,120}setOptimisticConversationState\(\(current\) => \(\{[\s\S]{0,80}muted: nextMuted/,
  );
});

test('chat info screen rollback drops optimistic overrides instead of restoring stale snapshots', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const dropOptimisticConversationStateKey = useCallback/);
  assert.match(source, /if \(current\[key\] === undefined\) \{/);
  assert.match(source, /delete nextState\[key\];/);
  assert.match(
    source,
    /void runConversationAction\(\s*'pin',[\s\S]{0,400}dropOptimisticConversationStateKey\('pinned'\)/,
  );
  assert.match(
    source,
    /void runConversationAction\(\s*'mute',[\s\S]{0,600}dropOptimisticConversationStateKey\('muted'\)/,
  );
  assert.doesNotMatch(source, /pinned: previousPinned/);
  assert.doesNotMatch(source, /muted: previousMuted/);
});

test('chat info screen ignores stale async completions after the conversation changes', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const currentConversationIDRef = useRef\(''\);/);
  // 契约随自研栈迁移更新(意图不变):会话 id 字段由 conversationID 换成 dto.id。
  assert.match(
    source,
    /const resolvedConversationID = activeConversation\?\.id \?\? '';\s*currentConversationIDRef\.current = resolvedConversationID;/s,
  );
  assert.match(source, /currentConversationIDRef\.current = resolvedConversationID;/);
  assert.match(source, /const isActionConversationCurrent = useCallback/);
  assert.match(source, /currentConversationIDRef\.current === conversationID/);
  assert.match(source, /const actionConversationID = resolvedConversationID;/);
  assert.match(
    source,
    /if \(\s*isActionConversationCurrent\(actionConversationID\) &&[\s\S]{0,120}isLatestActionRequest\(action, actionRequestToken\)\s*\) \{\s*rollback\?\.?\(\);/s,
  );
  assert.match(
    source,
    /if \(\s*isActionConversationCurrent\(actionConversationID\) &&[\s\S]{0,120}isLatestActionRequest\(action, actionRequestToken\)\s*\) \{\s*setConversationActionPending\(action, false\);/s,
  );
  assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*currentConversationIDRef\.current = resolvedConversationID;/s);
});

test('chat info screen only lets the latest request for an action finish cleanup', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  // 契约随自研栈迁移更新(意图不变):burn/clear 动作已随功能删除,只剩 pin/mute。
  assert.match(source, /const actionRequestTokenRef = useRef\(\{\s*pin: 0,\s*mute: 0,\s*\}\);/s);
  assert.match(source, /const startActionRequest = useCallback/);
  assert.match(source, /const nextToken = actionRequestTokenRef\.current\[action\] \+ 1;/);
  assert.match(
    source,
    /actionRequestTokenRef\.current = \{\s*\.\.\.actionRequestTokenRef\.current,\s*\[action\]: nextToken,\s*\};/s,
  );
  assert.match(source, /return nextToken;/);
  assert.match(source, /const isLatestActionRequest = useCallback/);
  assert.match(source, /actionRequestTokenRef\.current\[action\] === requestToken/);
  assert.match(source, /const actionRequestToken = startActionRequest\(action\);/);
  assert.match(
    source,
    /if \(\s*isActionConversationCurrent\(actionConversationID\) &&\s*isLatestActionRequest\(action, actionRequestToken\)\s*\) \{\s*rollback\?\.?\(\);/s,
  );
  assert.match(
    source,
    /if \(\s*isActionConversationCurrent\(actionConversationID\) &&\s*isLatestActionRequest\(action, actionRequestToken\)\s*\) \{\s*setConversationActionPending\(action, false\);/s,
  );
});

test('chat info screen opens chat background selection without a status label', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /getChatBackgroundHref/);
  assert.match(source, /handleOpenChatBackground/);
  assert.match(source, /label=\{t\('chat\.chatBackground'\)\}/);
  assert.doesNotMatch(source, /backgroundLabel/);
  assert.doesNotMatch(source, /rightText={backgroundLabel}/);
  assert.match(source, /onPress={handleOpenChatBackground}/);
});

test('chat info screen wires recommend-friend navigation from the friend recommendation row', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /getRecommendFriendHref/);
  assert.match(source, /const handleOpenRecommendFriend = useCallback/);
  assert.match(source, /router\.push\(\s*getRecommendFriendHref\(/);
  assert.match(source, /label=\{t\('chat\.recommendFriend'\)\}/);
  assert.match(source, /onPress={handleOpenRecommendFriend}/);
  assert.doesNotMatch(source, /openUnsupportedAction\(t\('chat\.recommendFriend'\)\)/);
});

test('chat info screen wires search-history navigation from the new row', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /getChatHistorySearchHubHref/);
  // 契约随自研栈迁移更新(意图不变):单聊 get-or-create 走 chat-core 的
  // ensureDirectConversation。
  assert.match(source, /ensureDirectConversation/);
  assert.match(source, /const resolveConversationIDForNavigation = useCallback/);
  assert.match(source, /const existingConversationID = resolvedConversationID\.trim\(\);/);
  assert.match(source, /const conversation = await ensureDirectConversation\(friendId\);/);
  assert.match(source, /return conversation\.conversationID;/);
  assert.match(source, /const handleOpenSearchHistory = useCallback/);
  assert.match(source, /const nextConversationID = await resolveConversationIDForNavigation\(\);/);
  assert.match(source, /if \(!nextConversationID\) \{\s*return;\s*\}/s);
  assert.match(source, /router\.push\(\s*getChatHistorySearchHubHref\(/);
  assert.match(source, /label=\{t\('chat\.searchHistory'\)\}/);
  assert.match(source, /onPress={handleOpenSearchHistory}/);
});

test('chat info screen resolves back navigation from the explicit origin instead of the current stack state', () => {
  const filePath = path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /originScope\?: string;/);
  assert.match(source, /const originScope =/);
  assert.match(source, /getUserProfileHref/);
  assert.match(source, /const backHref = useMemo/);
  assert.match(source, /originScope === 'messages'/);
  assert.match(source, /getChatDetailHref\(/);
  assert.match(source, /getUserProfileHref\(originScope, friendId, friendName\)/);
  assert.match(source, /<NavHeader[\s\S]{0,200}fallbackHref=\{backHref\}/s);
  assert.doesNotMatch(source, /<NavHeader[\s\S]{0,200}onBackPress=/s);
});

test('messages layout registers chat history search routes', () => {
  const filePath = path.join(process.cwd(), 'app/(tabs)/messages/_layout.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /<Stack\.Screen name="chat-history-search" \/>/);
  assert.match(source, /<Stack\.Screen name="chat-history-text" \/>/);
  assert.match(source, /<Stack\.Screen name="chat-history-media" \/>/);
  assert.match(source, /<Stack\.Screen name="chat-history-files" \/>/);
  assert.match(source, /<Stack\.Screen name="chat-history-date" \/>/);
});

test('chat history search screens exist with dedicated titles and empty states', () => {
  const hubSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistorySearchHubScreen.tsx'),
    'utf8',
  );
  const textSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryTextScreen.tsx'),
    'utf8',
  );
  const mediaSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryMediaScreen.tsx'),
    'utf8',
  );
  const filesSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryFilesScreen.tsx'),
    'utf8',
  );
  const dateSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryDateScreen.tsx'),
    'utf8',
  );

  assert.match(hubSource, /NavHeader[\s\S]*title=\{t\('chat\.history\.findTitle'\)\}/);
  assert.match(hubSource, /fallbackHref={getChatDetailHref\('messages', sourceID, title, undefined, conversationID\)}/);
  assert.match(hubSource, /t\('chat\.history\.textTitle'\)/);
  assert.match(hubSource, /t\('chat\.history\.mediaTitle'\)/);
  assert.match(hubSource, /t\('chat\.history\.files'\)/);
  assert.match(hubSource, /t\('chat\.history\.dateTitle'\)/);

  assert.match(textSource, /searchChatMessages\(conversationID, \{\s*keyword/);
  assert.match(textSource, /t\('chat\.history\.noMatches'\)/);

  assert.match(mediaSource, /searchChatMessages\(conversationID, \{ types: \['image'\]/);
  assert.match(mediaSource, /t\('chat\.history\.noMedia'\)/);

  assert.match(filesSource, /searchChatMessages\(conversationID, \{ types: \['file'\]/);
  assert.match(filesSource, /暂无文件记录/);

  // 日历页现在是纯选择器：点日期跳「当天记录」结果页，搜索逻辑搬去结果页了。
  assert.match(dateSource, /getChatHistoryDateResultsHref/);
  assert.match(dateSource, /t\('chat\.history\.pickDate'\)/);
});

test('chat history hub has a top keyword search box', () => {
  const hubSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistorySearchHubScreen.tsx'),
    'utf8',
  );

  assert.match(hubSource, /const \[keyword, setKeyword\] = useState\(''\)/);
  assert.match(hubSource, /TextInput/);
  assert.match(hubSource, /placeholder=\{t\('chat\.history\.searchPlaceholder'\)\}/);
  assert.match(hubSource, /handleSubmitKeywordSearch/);
  assert.match(hubSource, /getChatHistoryTextHref\(conversationID, sourceID, title, nextKeyword\)/);
});

test('chat history date screen uses an inline calendar grid instead of typed date search', () => {
  const dateSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryDateScreen.tsx'),
    'utf8',
  );

  assert.match(dateSource, /CALENDAR_COLUMNS/);
  assert.match(dateSource, /buildCalendarDays/);
  assert.match(dateSource, /calendarGrid/);
  assert.match(dateSource, /handleMonthOffset/);
  assert.match(dateSource, /handleSelectDate/);
  // 有记录的日子上色所需的当月记录集合（取代旧的 selectedDate 内联选中态）。
  assert.match(dateSource, /recordDays/);
  assert.match(dateSource, /formatCalendarMonthTitle/);
  assert.doesNotMatch(dateSource, /placeholder="YYYY-MM-DD"/);
  assert.doesNotMatch(dateSource, /keyboardType="numbers-and-punctuation"/);
});

test('chat history media screen groups media by month in a three-column grid', () => {
  const mediaSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryMediaScreen.tsx'),
    'utf8',
  );

  assert.match(mediaSource, /MEDIA_GRID_COLUMNS = 3/);
  assert.match(mediaSource, /groupMediaMessagesByMonth/);
  assert.match(mediaSource, /SectionList/);
  assert.match(mediaSource, /renderSectionHeader/);
  assert.match(mediaSource, /mediaGrid/);
  assert.match(mediaSource, /aspectRatio:\s*1/);
  assert.match(mediaSource, /play-circle/);
  assert.match(mediaSource, /formatChatHistoryMonth/);
});

test('chat history media grid normalizes urls and falls back across image candidates', () => {
  const mediaSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryMediaScreen.tsx'),
    'utf8',
  );

  assert.match(mediaSource, /normalizeMediaUrl/);
  assert.match(mediaSource, /getMediaThumbnailUris/);
  // chat-core:缩略 → 原图 → 乐观期本地 uri 的降级链。
  assert.match(mediaSource, /content\['thumbUrl'\]/);
  assert.match(mediaSource, /content\['url'\]/);
  assert.match(mediaSource, /content\['localUri'\]/);
  assert.match(mediaSource, /handleImageError/);
  assert.match(mediaSource, /onError=\{handleImageError\}/);
});

test('chat info revalidates ownership before mutating a member role', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx'),
    'utf8',
  );

  // review R3：action sheet 打开到点确认之间可能失去群主身份，PATCH 前
  // 现场重查自己的角色（不吃创建 alert 时捕获的 currentRole），fail-closed。
  // 契约随自研栈迁移更新(意图不变):现场重查改走 fetchCircleDetail 的
  // myRole/myStatus(圈子角色即群角色事实源)。
  assert.match(source, /const freshDetail = await fetchCircleDetail\(groupID\);/);
  assert.match(
    source,
    /const freshRole = freshDetail\.myStatus === 'ACTIVE' \? freshDetail\.myRole : null;/,
  );
  assert.match(
    source,
    /if \(!canChangeGroupMemberRole\(freshSelfRoleLevel, memberRoleLevel\(member\)\)\) \{\s*\n\s*Alert\.alert\(t\('chat\.groupMembersRestricted'\)\);/,
  );
  // 重查通过后才发 PATCH。
  assert.match(
    source,
    /canChangeGroupMemberRole\(freshSelfRoleLevel[\s\S]{0,220}await updateGroupMemberRole\(groupID, member\.userId, nextRole\)/,
  );
});
