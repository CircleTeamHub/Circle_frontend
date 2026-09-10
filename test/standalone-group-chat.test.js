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
  // 群备注(只有我看得见)排最前;没设置才是圈子群的 circle.name、
  // 独立群的会话 name,空名兜底「群聊」。
  assert.match(mappers, /dto\.myRemark\?\.trim\(\) \|\|/);
  assert.match(mappers, /dto\.circle\?\.name \|\|/);
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
    assert.match(controller, /@Post\('conversations\/:id\/dissolve'\)/);
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
      'CHAT_GROUP_OWNER_ONLY',
    ]) {
      assert.match(backendCodes, new RegExp(`'${code}'`), `BE missing ${code}`);
      assert.match(feCodes, new RegExp(`'${code}'`), `FE missing ${code}`);
    }
  },
);

test('group owner dissolves instead of leaving, and dissolve wipes everyone', () => {
  const screen = read('src/features/chat/screens/ChatInfoScreen.tsx');

  // 群主只能从会话 dto 的 ownerId 认:独立群没有圈子角色可查。
  assert.match(screen, /const isStandaloneGroupOwner =\s*\n\s*isStandaloneGroup &&/);
  assert.match(screen, /conversation\?\.ownerId === currentUserID/);
  // 底部按钮按身份分叉:群主=解散,成员=退出。
  // (圈子群的圈主也走解散,但解散的是整个圈子、端点不同 —— 见
  //  circle-owner-dissolve.test.js。)
  assert.match(
    screen,
    /isStandaloneGroupOwner\s*\n?\s*\? handleDissolveGroup/,
  );
  assert.match(
    screen,
    /isStandaloneGroupOwner \|\| isCircleOwner\s*\n?\s*\? t\('chat\.dissolve'\)\s*\n?\s*: t\('chat\.leave'\)/,
  );
  // 解散必须走二次确认,并且警示文案要说清「所有人的记录都会删」。
  assert.match(screen, /Alert\.alert\(\s*t\('chat\.dissolveGroup'\),\s*t\('chat\.dissolveGroupWarning'\)/);
  assert.match(screen, /dissolveGroupChatConversation\(conversationID\)/);

  const api = read('src/chat-core/api.ts');
  assert.match(
    api,
    /export function dissolveGroupChatConversation\([\s\S]*?\/chat\/conversations\/\$\{conversationId\}\/dissolve/,
  );

  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const bundle = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    for (const key of ['dissolve', 'dissolveGroup', 'dissolveGroupWarning']) {
      assert.ok(bundle.chat[key], `${locale} chat.${key}`);
    }
    assert.ok(
      bundle.serverErrors.CHAT_GROUP_OWNER_ONLY,
      `${locale} serverErrors.CHAT_GROUP_OWNER_ONLY`,
    );
  }

  const codes = read('src/services/api/server-error-codes.ts');
  assert.match(codes, /'CHAT_GROUP_OWNER_ONLY'/);
});

test('group info sections are separated by dividers at every boundary', () => {
  const screen = read('src/features/chat/screens/ChatInfoScreen.tsx');
  const groupLayout = screen.slice(screen.indexOf('if (isGroupConversation) {'));

  // groupContent 没有 gap,各段是同一块 surface 直接相接的 —— 段尾不补
  // Divider 就会出现「有的行有线、有的行没线」。每个 groupSection 收尾都要有。
  const sections = groupLayout.split('<View style={[s.groupSection, d.groupSection]}>').slice(1);
  assert.equal(sections.length, 4, 'expected four group info sections');
  for (const [index, section] of sections.entries()) {
    const body = section.slice(0, section.indexOf('\n          </View>'));
    assert.match(
      body.trimEnd().slice(-40),
      /<Divider \/>$/,
      `group section ${index + 1} must end with a divider`,
    );
  }
});

test('only the group owner gets two-way clear and the burn timer', () => {
  const screen = read('src/features/chat/screens/ChatInfoScreen.tsx');

  // 能不能全群清空/设置焚毁,前端判据必须和后端一致:圈子群=圈主或管理员,
  // 独立群=群主。不一致就会给普通成员摆一个必然报错的按钮。
  assert.match(
    screen,
    /const canWipeGroupForEveryone =\s*\n?\s*canManageGroup \|\| isStandaloneGroupOwner;/,
  );
  // 焚毁入口:原来只认 canManageGroup,独立群聊的群主永远看不到它。
  assert.match(screen, /\{canWipeGroupForEveryone \? \(/);
  // 普通成员那条分支:先于双选对话框返回,只留一个「只清我这份」的动作。
  assert.match(
    screen,
    /if \(!canWipeGroupForEveryone\) \{[\s\S]*?clearHistory\(false\)[\s\S]*?return;\s*\n\s*\}/,
  );
  const memberBranch = screen.slice(
    screen.indexOf('if (!canWipeGroupForEveryone) {'),
  );
  const memberBranchBody = memberBranch.slice(0, memberBranch.indexOf('return;'));
  assert.doesNotMatch(
    memberBranchBody,
    /clearHistoryForEveryone|clearHistory\(true\)/,
    'member branch must never offer a delete-for-everyone action',
  );
  // 群主的对话框文案要说清两个按钮的区别。
  assert.match(screen, /t\('chat\.clearHistoryConfirmGroupOwner'\)/);

  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const bundle = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(
      bundle.chat.clearHistoryConfirmGroupOwner,
      `${locale} chat.clearHistoryConfirmGroupOwner`,
    );
  }
});
