const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 独立群聊(微信群):不挂圈子的 GROUP 会话。这组测试钉住「群 ≠ 圈子」的
// 判别边界 —— 漏一处,独立群就会拿会话 id 去请求 /circle/:id(全体 404),
// 或圈子群把成员管理放给了不该放的人。
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('conversation mapper titles standalone groups by their own name', () => {
  const mappers = read('src/chat-core/mappers.ts');
  // 圈子群优先 circle.name;独立群用会话 name,空名兜底「群聊」。
  assert.match(mappers, /dto\.circle\?\.name \?\?/);
  assert.match(mappers, /dto\.name\?\.trim\(\)/);
  assert.match(mappers, /messages\.newGroupDefaultName/);
  // 独立群的 sourceID 退回会话 id(圈子群仍是圈子 id)。
  assert.match(mappers, /dto\.circleId \?\? dto\.id/);

  const protocol = read('src/chat-core/protocol.ts');
  assert.match(protocol, /name\?: string \| null/);
  assert.match(protocol, /ownerId\?: string \| null/);
});

test('chat detail treats standalone groups as member-visible, not circle-gated', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /const isStandaloneGroup =/);
  // 独立群不请求圈子角色(sourceID 不是圈子 id)。
  assert.match(screen, /enabled: isGroupChat && !isTempChat && !isStandaloneGroup/);
  assert.match(
    screen,
    /canViewGroupMemberProfiles =\s*isTempChat \|\| isStandaloneGroup \|\| canViewCircleMembers/,
  );
});

test('chat info screen separates standalone-group and circle-group flows', () => {
  const screen = read('src/features/chat/screens/ChatInfoScreen.tsx');
  assert.match(screen, /const isStandaloneGroup =/);
  // groupID(圈子 id)对独立群必须为空,否则圈子请求会拿会话 id 打 404。
  assert.match(
    screen,
    /isGroupConversation && !isTempConversation && !isStandaloneGroup\s*\?/,
  );
  // 改名/退群走 /chat/conversations/:id 专属端点。
  assert.match(screen, /renameGroupChatConversation\(conversationID/);
  assert.match(screen, /leaveGroupChatConversation\(conversationID\)/);
  // 目录直接按会话 id 取,不经过「取或建圈子群」。
  assert.match(
    screen,
    /if \(isStandaloneGroup && conversationID\) \{[\s\S]{0,400}fetchChatMembers\(conversationID\)/,
  );
  // 点成员资料时，非圈子会话按当前 conversation 现场重拉成员并 fail-closed；
  // 不能调用 disabled 的 circle-only revalidate() 后固定返回 false。
  assert.match(
    screen,
    /if \(isStandaloneGroup \|\| isTempConversation\) \{[\s\S]{0,500}fetchChatMembers\(memberConversationID\)/,
  );
  assert.match(screen, /members\.some\(\(item\) => item\.userId === member\.userId\)/);
  assert.match(screen, /else if \(!\(await revalidateMemberAccess\(\)\)\)/);

  // Android 没有 Alert.prompt；独立群改名必须走所有平台都可用的受控弹窗。
  assert.match(screen, /\bModal\b/);
  assert.match(screen, /\bTextInput\b/);
  assert.match(
    screen,
    /if \(isStandaloneGroup\) \{[\s\S]{0,240}setRenameDraft\(groupTitle\)[\s\S]{0,160}setRenameDialogVisible\(true\)/,
  );
  assert.match(screen, /<Modal[\s\S]{0,1800}<TextInput/);
  assert.match(screen, /await renameGroupChatConversation\(conversationID, trimmed\)/);
});

test('new group screen submits selected friends through chat-core', () => {
  const screen = read('src/features/chat/screens/NewGroupScreen.tsx');
  assert.match(screen, /createGroupConversation\(\{/);
  assert.match(screen, /memberIds: Object\.keys\(selected\)/);
  assert.match(screen, /submittingRef = useRef\(false\)/);
  assert.match(screen, /if \(submittingRef\.current\) return/);
  assert.match(screen, /submittingRef\.current = true/);
  assert.match(screen, /submittingRef\.current = false/);
  // 服务端 ArrayMinSize(2) 的同款下限,提交前先在端上拦。
  assert.match(screen, /MIN_MEMBERS = 2/);
  // 建完 replace 进聊天页,返回不落回选人页。
  assert.match(screen, /router\.replace\(/);
});

test('invite screen filters seated members and submits through chat-core', () => {
  const screen = read('src/features/chat/screens/InviteGroupMembersScreen.tsx');
  assert.match(screen, /inviteGroupChatMembers\(/);
  assert.match(screen, /!memberIDs\.has\(friend\.id\)/);
  assert.match(screen, /fetchChatMembers\(conversationID\)/);
});

test('system notice mapper renders the group-renamed kind', () => {
  const mappers = read('src/chat-core/message-mappers.ts');
  assert.match(mappers, /case 'group-renamed':/);
  assert.match(mappers, /im\.notification\.groupRenamed/);
});

// ── 跨仓契约:双仓并排检出时逐项对齐;仅前端 CI 时跳过 ──
const BACKEND_ROOT = path.join(__dirname, '..', '..', 'circle_be');
const hasBackend = fs.existsSync(
  path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'),
);

test(
  'standalone group endpoints exist on the backend controller',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const controller = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'),
      'utf8',
    );
    assert.match(controller, /@Post\('conversations\/group'\)/);
    assert.match(controller, /@Post\('conversations\/:id\/members'\)/);
    assert.match(controller, /@Post\('conversations\/:id\/leave'\)/);
    assert.match(controller, /@Patch\('conversations\/:id\/name'\)/);
  },
);

test(
  'standalone group error codes are registered on both sides',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const backendCodes = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/common/app-error-codes.ts'),
      'utf8',
    );
    const feCodes = read('src/services/api/server-error-codes.ts');
    for (const code of [
      'CHAT_GROUP_FRIENDS_ONLY',
      'CHAT_GROUP_MIN_MEMBERS',
      'CHAT_GROUP_CIRCLE_MANAGED',
    ]) {
      assert.match(backendCodes, new RegExp(`'${code}'`), `BE missing ${code}`);
      assert.match(feCodes, new RegExp(`'${code}'`), `FE missing ${code}`);
    }
  },
);
