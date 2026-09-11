const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 群设置第二批:全员禁言开关、群主转让、独立群公告/头像、群成员行、进群允许方式、
// 成员权限(可查看资料 / 可加好友)。这组断言钉住三件事:客户端接线完整、
// 每个新词条五语种齐全、以及与后端的跨仓契约(端点、错误码、策略键)。
const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];
const locale = (lng) => JSON.parse(read(`src/i18n/locales/${lng}.json`));

const POLICY_KEYS = [
  'memberCanInvite',
  'qrJoinEnabled',
  'membersCanViewRoster',
  'membersCanViewProfiles',
  'membersCanAddFriends',
];

const NEW_ERROR_CODES = [
  'CHAT_GROUP_INVITE_DISABLED',
  'CHAT_GROUP_QR_JOIN_DISABLED',
  'CHAT_GROUP_AVATAR_URL_INVALID',
  'FRIEND_GROUP_ADD_FORBIDDEN',
  // 「成员可查看他人资料」关着的群里打开对方资料页:服务端 403。
  'CHAT_MEMBER_PROFILE_FORBIDDEN',
];

test('chat-core exposes the five group settings endpoints', () => {
  const api = read('src/chat-core/api.ts');
  assert.match(api, /export function setGroupChatMuteAll\(/);
  assert.match(api, /\/mute-all`,\s*\{ method: 'PATCH', body: \{ enabled \} \}/);
  assert.match(api, /export function transferGroupChatOwner\(/);
  assert.match(api, /\/owner`, \{\s*method: 'POST',\s*body: \{ userId \}/);
  assert.match(api, /export function setGroupChatNotice\(/);
  assert.match(api, /\/notice`,\s*\{ method: 'PATCH', body: \{ notice \} \}/);
  assert.match(api, /export function setGroupChatAvatar\(/);
  assert.match(api, /\/avatar`,\s*\{ method: 'PATCH', body: \{ avatarUrl \} \}/);
  assert.match(api, /export function updateGroupChatPolicies\(/);
  assert.match(api, /\/policies`,\s*\{ method: 'PATCH', body: patch \}/);
});

test('the conversation DTO carries the new group fields as optional (old backends stay valid)', () => {
  const protocol = read('src/chat-core/protocol.ts');
  assert.match(protocol, /export interface ChatGroupPoliciesDto/);
  for (const key of POLICY_KEYS) {
    assert.match(protocol, new RegExp(`${key}: boolean;`), `policies lacks ${key}`);
  }
  // 老后端不下发这些字段:全部可选,缺省按放开处理,不能让会话列表整体失效。
  for (const field of ['muteAll', 'notice', 'avatarUrl', 'memberLimit', 'myRole', 'policies', 'myRemark']) {
    assert.match(protocol, new RegExp(`\\s${field}\\?:`), `ChatConversationDto lacks optional ${field}`);
  }
});

test('new error codes are mirrored and localized in five languages', () => {
  const codes = read('src/services/api/server-error-codes.ts');
  for (const code of NEW_ERROR_CODES) {
    assert.match(codes, new RegExp(`'${code}'`), `server-error-codes lacks ${code}`);
  }
  for (const lng of LOCALES) {
    const errors = locale(lng).serverErrors;
    for (const code of NEW_ERROR_CODES) {
      assert.equal(
        typeof errors[code] === 'string' && errors[code].trim().length > 0,
        true,
        `${lng}.json serverErrors lacks ${code}`,
      );
    }
  }
});

test('system notices and group log cover mute-all, avatar and policy changes', () => {
  const mapper = read('src/chat-core/message-mappers.ts');
  for (const kind of ['mute-all-changed', 'group-avatar-updated', 'group-policy-changed']) {
    assert.match(mapper, new RegExp(`case '${kind}'`), `systemNoticeText lacks ${kind}`);
  }
  // 策略名一张表,系统提示与群日志共用;不认识的键原样显示而不是空白。
  assert.match(mapper, /export function groupPolicyLabel\(/);
  for (const key of POLICY_KEYS) {
    assert.match(mapper, new RegExp(`${key}: 'chat\\.groupPolicy\\.${key}'`));
  }
  const events = read('src/chat-core/group-events.ts');
  for (const kind of ['mute-all-changed', 'group-avatar-updated', 'policy-changed']) {
    assert.match(events, new RegExp(`case '${kind}'`), `groupEventText lacks ${kind}`);
  }

  for (const lng of LOCALES) {
    const data = locale(lng);
    for (const key of ['muteAllEnabled', 'muteAllDisabled', 'groupAvatarUpdated', 'policyEnabled', 'policyDisabled']) {
      assert.equal(typeof data.im.notification[key], 'string', `${lng}.json lacks im.notification.${key}`);
    }
    for (const key of POLICY_KEYS) {
      assert.equal(typeof data.chat.groupPolicy[key], 'string', `${lng}.json lacks chat.groupPolicy.${key}`);
      assert.equal(typeof data.chat.groupPolicyHint[key], 'string', `${lng}.json lacks chat.groupPolicyHint.${key}`);
    }
    for (const key of ['muteAll', 'muteAllHint', 'youAreMutedAll', 'transferOwner', 'transferOwnerConfirm', 'transferOwnerDone', 'transferOwnerAction', 'raiseMemberLimit', 'groupAvatar', 'groupMembersRow', 'memberCountWithLimit', 'memberCountOnly', 'profilesRestrictedByGroup']) {
      assert.equal(typeof data.chat[key], 'string', `${lng}.json lacks chat.${key}`);
    }
    for (const key of ['settings', 'ownerSection', 'joinMethods', 'memberPermissions', 'pickNewOwner']) {
      assert.equal(typeof data.chat.groupManagement[key], 'string', `${lng}.json lacks chat.groupManagement.${key}`);
    }
  }
});

test('the group manage screen switches mute-all, the four policies, transfer and expansion', () => {
  const screen = read('src/features/chat/screens/GroupManageScreen.tsx');
  assert.match(screen, /setGroupChatMuteAll\(conversationID, next\)/);
  assert.match(screen, /updateGroupChatPolicies\(conversationID, \{ \[key\]: next \}\)/);
  assert.match(screen, /transferGroupChatOwner\(conversationID, member\.userId\)/);
  // 乐观更新 + 失败回滚:开关按下即翻,请求失败翻回去。
  assert.match(screen, /patchConversation\(\{ muteAll: next \}\)/);
  assert.match(screen, /patchConversation\(\{ muteAll: !next \}\)/);
  // 策略回滚只翻这一个键,且基于**当时**缓存里的那份 —— 写回按下那一刻捕获的
  // 整份快照会把期间 dispatcher 应用的远端 group-policy-changed 一起抹掉。
  assert.match(screen, /const patchPolicyKey = useCallback\(/);
  assert.match(screen, /policies: \{ \.\.\.cached\.policies, \[key\]: value \}/);
  assert.match(screen, /const previous = policies\[key\];/);
  assert.match(screen, /patchPolicyKey\(key, previous\);/);
  assert.doesNotMatch(screen, /patchConversation\(\{ policies \}\)/);
  // 回滚之后再重拉一次:服务端上真正的状态说了算。
  assert.match(screen, /const resyncConversations = useCallback\(/);
  assert.match(screen, /void loadChatConversations\(\)/);
  // 群主转让只属于独立群聊;提升成员上限只属于圈子群。
  assert.match(screen, /isStandaloneGroup\s*\?\s*renderLinkRow\(/);
  assert.match(screen, /pathname: '\/\(tabs\)\/profile\/group-expansion'/);
  assert.match(screen, /params: \{ circleId: groupID \}/);
  const expansion = read('src/features/profile/screens/GroupExpansionScreen.tsx');
  assert.match(expansion, /preselectedCircleId/);
});

test('chat info exposes the avatar row, the member row and hides the QR entry when joining is off', () => {
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  assert.match(info, /chat\.groupAvatar/);
  // 群头像与圈子头像共用同一个 hook(原来是两份逐字复制的 115 行)。
  assert.match(info, /useChangeAvatar\(\{/);
  assert.match(info, /submit: submitGroupAvatar,/);
  assert.match(info, /onChanged: handleGroupAvatarChanged,/);
  // 圈子群走圈子头像端点(仅圈主),独立群聊走会话头像端点(群主/管理员)。
  assert.match(info, /await setGroupChatAvatar\(target, fileUrl\)/);
  assert.match(info, /await setCircleAvatar\(groupID, fileUrl\)/);
  assert.match(info, /const canChangeGroupAvatar = isStandaloneGroup \? canManageGroup : isOwner;/);
  assert.match(info, /chat\.groupMembersRow/);
  assert.match(info, /chat\.memberCountWithLimit/);
  // 二维码入群关掉后群码入口一并收起:留着只会让人扫一张必然被拒的码。
  assert.match(info, /\) : qrJoinEnabled \? \(/);
  // 独立群聊的公告读写会话行。
  assert.match(info, /activeConversation\?\.notice\?\.trim\(\)/);
  const noticeScreen = read('src/features/chat/screens/EditGroupNoticeScreen.tsx');
  assert.match(noticeScreen, /await setGroupChatNotice\(conversationID, nextNotice\)/);
});

test('member profiles and friend requests honor the two member-permission switches', () => {
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  // 「成员可查看他人资料」:群主/管理员不受限,看自己永远放行。判据只有一份
  // (features/chat/utils/group-policy),三张屏共用 —— 见 group-policy-gate.test.js。
  assert.match(info, /const canViewMemberProfiles = allowsMemberProfiles\(groupPolicyActor\);/);
  assert.match(info, /member\.userId !== currentUserID &&\s*\n\s*!canViewMemberProfiles/);

  const detail = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(detail, /const canViewMemberProfilesByPolicy = useChatStore/);
  assert.match(detail, /viaConversationID: conversationID/);

  const search = read('src/features/chat/screens/SearchGroupMembersScreen.tsx');
  assert.match(search, /const canOpenMemberProfiles = useChatStore/);
  // 成员搜索页也要带上会话 id:资料页据此按本群的「成员可添加好友」收起入口。
  assert.match(search, /viaConversationID: memberConversationID/);

  // 「成员可添加好友」:资料页按群策略收起入口,申请页把 viaConversationId 交给服务端。
  const profile = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(profile, /const viaGroupForbidsFriendRequests = useChatStore/);
  assert.match(profile, /membersCanAddFriends === false &&\s*\n\s*!isGroupManager/);
  assert.match(profile, /const showAddFriendButton = canSendFriendRequest && !viaGroupForbidsFriendRequests;/);
  const request = read('src/features/social/screens/SendFriendRequestScreen.tsx');
  assert.match(request, /viaConversationId:/);
  const friendsApi = read('src/services/api/friends.ts');
  assert.match(friendsApi, /viaConversationId\?: string;/);
  assert.match(friendsApi, /input\.viaConversationId\s*\?\s*\{ viaConversationId: input\.viaConversationId \}/);
});

test('a profile blocked by the group policy explains itself instead of saying load failed', () => {
  const profile = read('src/features/user/screens/UserProfileScreen.tsx');
  // 服务端也拦(客户端的开关只管入口),被拦时得说清是群规矩挡的;
  // 原始错误文本仍然走同一个漏斗,永不直出。
  assert.match(
    profile,
    /setFetchError\(getApiErrorMessage\(error, t\('userProfile\.loadFailed'\)\)\)/,
  );
  assert.doesNotMatch(profile, /setFetchError\(t\('userProfile\.loadFailed'\)\)/);
});

test('the invite screen survives a forbidden member directory', () => {
  const invite = read('src/features/chat/screens/InviteGroupMembersScreen.tsx');
  // 目录对普通成员会 403(CHAT_MEMBER_DIRECTORY_FORBIDDEN);Promise.all 会连好友
  // 列表一起丢掉,邀请页整片空白。两次请求各算各的。
  assert.match(invite, /await Promise\.allSettled\(\[/);
  assert.doesNotMatch(invite, /await Promise\.all\(\[/);
  assert.match(invite, /memberResult\.status === 'fulfilled'/);
  assert.match(invite, /setMemberIDs\(new Set\(\)\);/);
  // 好友列表拿不到是用户要知道的事,走同一个本地化漏斗。
  assert.match(
    invite,
    /getApiErrorMessage\(friendResult\.reason, t\('common\.networkError'\)\)/,
  );
  // 提交被拒时同样出错误码文案,而不是「网络错误」一刀切。
  assert.match(
    invite,
    /error: getApiErrorMessage\(error, t\('common\.networkError'\)\),/,
  );
});

test('chat detail locks the composer under group-wide mute for non-managers', () => {
  const detail = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(detail, /const groupMuteAllActive = useChatStore/);
  assert.match(detail, /return !isGroupManager\(conversation\.myRole \?\? null\);/);
  assert.match(detail, /const composerLocked = selfSilenced \|\| groupMuteAllActive;/);
  assert.match(detail, /chat\.youAreMutedAll/);
});

test('remote mute-all and policy changes update the cached conversation', () => {
  const dispatcher = read('src/chat-core/dispatcher.ts');
  assert.match(dispatcher, /function applyRemoteGroupSettingChange\(/);
  assert.match(dispatcher, /applyRemoteGroupSettingChange\(store, payload\);/);
  // 系统提示播给整个会话房,客户端据此翻转本地状态,不靠 N 条个人房 updated。
  // (行为断言在 chat-core-dispatcher.test.js:真的发一条系统消息进去看 store。)
  assert.match(dispatcher, /kind !== 'mute-all-changed' && kind !== 'group-policy-changed'/);
  // `policy in policies` 会连原型链一起认:policy:'toString' 就能挂上一个自有键。
  assert.match(
    dispatcher,
    /Object\.prototype\.hasOwnProperty\.call\(conversation\.policies, policy\)/,
  );
});

// ── 跨仓契约:双仓并排检出时逐项对齐;仅前端 CI 时跳过 ──
// CIRCLE_BE_PATH 覆盖是给 git worktree 用的:worktree 旁边那个 circle_be 往往是
// 别的分支,比 main 还容易给出假红/假绿。
const BACKEND_ROOT =
  process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
const hasBackend = fs.existsSync(path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'));

test(
  'backend exposes the five group settings endpoints the client calls',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const controller = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'),
      'utf8',
    );
    assert.match(controller, /@Patch\('conversations\/:id\/mute-all'\)/);
    assert.match(controller, /@Post\('conversations\/:id\/owner'\)/);
    assert.match(controller, /@Patch\('conversations\/:id\/notice'\)/);
    assert.match(controller, /@Patch\('conversations\/:id\/avatar'\)/);
    assert.match(controller, /@Patch\('conversations\/:id\/policies'\)/);
  },
);

test(
  'policy keys, error codes and the friend-request field match the backend',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const types = fs.readFileSync(path.join(BACKEND_ROOT, 'src/chat/chat.types.ts'), 'utf8');
    const block = types.match(/export interface ChatGroupPoliciesDto \{([\s\S]*?)\n\}/);
    assert.ok(block, 'backend has no ChatGroupPoliciesDto');
    for (const key of POLICY_KEYS) {
      assert.match(block[1], new RegExp(`${key}: boolean;`), `backend policies lack ${key}`);
    }
    const codes = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/common/app-error-codes.ts'),
      'utf8',
    );
    for (const code of NEW_ERROR_CODES) {
      assert.match(codes, new RegExp(`'${code}'`), `backend lacks ${code}`);
    }
    // 加好友的群上下文字段名两边必须一致,写错就是静默失去这道闸。
    const friendDto = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/friend/dto/friend.dto.ts'),
      'utf8',
    );
    assert.match(friendDto, /viaConversationId\?: string;/);
  },
);
