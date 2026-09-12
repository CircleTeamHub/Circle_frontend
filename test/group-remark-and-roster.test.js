const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 群备注(我给这个群起的名字,只有我看得见)+「是否显示群成员」开关。
// 群备注与群昵称方向相反,和全群共享的群名也是两回事 —— 这组断言主要钉住
// 「谁看得见」这条线不被写串。
const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];
const locale = (lng) => JSON.parse(read(`src/i18n/locales/${lng}.json`));

test('the private group remark has its own endpoint, separate from the shared group name', () => {
  const api = read('src/chat-core/api.ts');
  assert.match(api, /export function setMyGroupChatRemark\(/);
  assert.match(api, /\/my-remark`,\s*\{ method: 'PATCH', body: \{ remark \} \}/);
  // 群昵称(全群可见)与群备注(只有我看得见)是两个端点,别写串。
  assert.match(api, /export function setMyGroupChatAlias\(/);
  assert.match(api, /\/my-alias`,/);
  // 改群名是另一回事:那条改的是全群共享的名字。
  assert.match(api, /export function renameGroupChatConversation\(/);
});

test('the conversation title prefers my private remark over the shared group name', () => {
  const mappers = read('src/chat-core/mappers.ts');
  assert.match(mappers, /dto\.myRemark\?\.trim\(\) \|\|/);
  // 顺序必须是 备注 → 圈子名 → 会话名 → 兜底,备注排第一。
  assert.match(
    mappers,
    /dto\.myRemark\?\.trim\(\) \|\|\s*\n\s*dto\.circle\?\.name \|\|\s*\n\s*dto\.name\?\.trim\(\)/,
  );
});

test('chat info offers the remark row and writes it back locally', () => {
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  assert.match(info, /chat\.groupRemark/);
  assert.match(info, /setMyGroupChatRemark\(target, value\)/);
  assert.match(info, /store\.upsertConversation\(\{ \.\.\.cached, myRemark: result\.remark \}\)/);
  // 群备注与群昵称是并列的两行,不能只留一行。
  assert.match(info, /chat\.myAliasInGroup/);
  // 两行挨着放,不写明「只有你自己看得见」会被当成同一件事 ——
  // 五语言都加了这条提示,别让它成为没人用的死键。
  assert.match(info, /subtitle=\{t\('chat\.groupRemarkHint'/);
});

test('the roster switch gates the member grid for ordinary members only', () => {
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  assert.match(info, /const rosterVisibleToMembers =/);
  assert.match(info, /membersCanViewRoster \?\? true/);
  // 群主/管理员不受限,判据与服务端 listMembers 一致。
  assert.match(
    info,
    /isGroupManager\(selfGroupRoleForRoster\) \|\|\s*\n\s*rosterVisibleToMembers/,
  );

  const manage = read('src/features/chat/screens/GroupManageScreen.tsx');
  assert.match(manage, /'membersCanViewRoster',/);
});

test('the roster switch is localized in five languages', () => {
  for (const lng of LOCALES) {
    const chat = locale(lng).chat;
    assert.equal(typeof chat.groupPolicy.membersCanViewRoster, 'string', `${lng} lacks policy label`);
    assert.equal(typeof chat.groupPolicyHint.membersCanViewRoster, 'string', `${lng} lacks policy hint`);
    assert.equal(typeof chat.groupRemark, 'string', `${lng} lacks chat.groupRemark`);
    assert.equal(typeof chat.groupRemarkHint, 'string', `${lng} lacks chat.groupRemarkHint`);
  }
});

// ── 跨仓契约 ──
// CIRCLE_BE_PATH 覆盖是给 git worktree 用的:worktree 旁边那个 circle_be 往往是
// 别的分支,比 main 还容易给出假红/假绿。
const BACKEND_ROOT =
  process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
const hasBackend = fs.existsSync(path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'));

test(
  'the backend keeps the remark on the seat and the roster switch on the conversation',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const controller = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'),
      'utf8',
    );
    assert.match(controller, /@Patch\('conversations\/:id\/my-remark'\)/);

    const schema = fs.readFileSync(
      path.join(BACKEND_ROOT, 'prisma/schema.prisma'),
      'utf8',
    );
    // remark 必须在 ChatMember 上(每人一份),不能落到 ChatConversation ——
    // 那样就变成了全群共享的群名。
    const member = schema.match(/model ChatMember \{([\s\S]*?)\n\}/);
    assert.ok(member, 'backend has no ChatMember model');
    assert.match(member[1], /remark\s+String\?/);
    const conversation = schema.match(/model ChatConversation \{([\s\S]*?)\n\}/);
    assert.ok(conversation, 'backend has no ChatConversation model');
    assert.doesNotMatch(conversation[1], /\n\s+remark\s+String\?/);
    // 开关默认开还是默认关是产品取舍(迁移可以整批回填),客户端两种都能跑 ——
    // 这里只钉「这一列在会话上」,不钉默认值。
    assert.match(
      conversation[1],
      /membersCanViewRoster\s+Boolean\s+@default\((?:true|false)\)/,
    );

    const types = fs.readFileSync(path.join(BACKEND_ROOT, 'src/chat/chat.types.ts'), 'utf8');
    assert.match(types, /myRemark: string \| null;/);
    assert.match(types, /membersCanViewRoster: boolean;/);
  },
);
