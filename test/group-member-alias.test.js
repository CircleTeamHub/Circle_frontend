const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 群昵称(群备注):本人在某个群里的显示名,对全群可见。
// 与好友备注区分 —— 好友备注是「我给对方起的名字、只有我看得见」,优先级更高;
// 群昵称是「我给自己起的名字、群里所有人看见」。这组断言钉住解析优先级、
// 展示链路是否处处走同一个解析器,以及跨仓的字段与端点契约。
const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadDisplayHelpers() {
  const filePath = path.join(root, 'src/features/chat/group-member-display.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, exports: {}, require: () => ({}) };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('display name prefers the group alias, then the account nickname, then the id', () => {
  const { groupMemberDisplayName } = loadDisplayHelpers();

  assert.equal(
    groupMemberDisplayName({ userId: 'u1', nickname: '张三', alias: '老张' }),
    '老张',
  );
  // 只有空白的别名不算设置过。
  assert.equal(
    groupMemberDisplayName({ userId: 'u1', nickname: '张三', alias: '   ' }),
    '张三',
  );
  assert.equal(groupMemberDisplayName({ userId: 'u1', nickname: '张三' }), '张三');
  assert.equal(groupMemberDisplayName({ userId: 'u1', nickname: '', alias: null }), 'u1');
});

test('member search matches the alias as well as the nickname and id', () => {
  const { groupMemberMatchesQuery } = loadDisplayHelpers();
  const member = { userId: 'uuid-abc', nickname: '张三', alias: '老张' };

  assert.equal(groupMemberMatchesQuery(member, '老'), true);
  assert.equal(groupMemberMatchesQuery(member, '张三'), true);
  assert.equal(groupMemberMatchesQuery(member, 'abc'), true);
  assert.equal(groupMemberMatchesQuery(member, '李四'), false);
  // 空查询不过滤任何人。
  assert.equal(groupMemberMatchesQuery(member, ''), true);
  assert.equal(groupMemberMatchesQuery({ userId: 'u', nickname: '张三' }, '老'), false);
});

test('the alias endpoint and the optional DTO field are wired in chat-core', () => {
  const api = read('src/chat-core/api.ts');
  assert.match(api, /export function setMyGroupChatAlias\(/);
  assert.match(api, /\/my-alias`,\s*\{ method: 'PATCH', body: \{ alias \} \}/);
  // 老后端不下发 alias:字段可选,缺省时回落账号昵称而不是让目录失效。
  assert.match(read('src/chat-core/protocol.ts'), /alias\?: string \| null;/);
});

test('every place that shows a member name goes through the shared resolver', () => {
  const files = [
    'src/features/chat/screens/ChatInfoScreen.tsx',
    'src/features/chat/screens/GroupManageScreen.tsx',
    'src/features/chat/screens/SearchGroupMembersScreen.tsx',
    'src/features/chat/components/group-member-picker-sheet.tsx',
    'src/features/chat/hooks/use-group-admin-actions.ts',
    'src/features/chat/screens/ChatDetailScreen.tsx',
  ];
  for (const rel of files) {
    const source = read(rel);
    assert.match(source, /groupMemberDisplayName/, `${rel} does not use the shared resolver`);
    // 散落的 `member.nickname || member.userId` 会绕过群昵称,显示成账号昵称。
    assert.doesNotMatch(
      source,
      /(member|item)\.nickname \|\| \1\.userId/,
      `${rel} still falls back to the raw nickname`,
    );
  }
});

test('chat bubbles and mentions use the alias while a personal friend remark still wins', () => {
  const detail = read('src/features/chat/screens/ChatDetailScreen.tsx');
  // 成员表映射用群昵称。
  assert.match(detail, /const nickname = groupMemberDisplayName\(member\);/);
  // @ 候选同样用群昵称。
  assert.match(detail, /nickname: groupMemberDisplayName\(member\),/);
  // 但我给这位好友起的备注优先级仍然最高(那条链不受本次改动影响)。
  assert.match(
    detail,
    /override\?\.remark \|\| memberName \|\| msg\.senderName \|\| conversationTitle/,
  );
});

test('chat info offers the alias row to every seated member, not just managers', () => {
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  assert.match(info, /chat\.myAliasInGroup/);
  assert.match(info, /setMyGroupChatAlias\(target, value\)/);
  // 入口不挂在 canManageGroup 上:改自己的名字是自助操作。
  assert.doesNotMatch(
    info,
    /canManageGroup \? \(\s*<>\s*<Divider \/>\s*<GroupInfoRow\s*label=\{t\('chat\.myAliasInGroup'/,
  );
  // 改完就地更新成员表,网格与聊天页的名字立刻跟上。
  assert.match(info, /member\.userId === currentUserID\s*\?\s*\{ \.\.\.member, alias: result\.alias \}/);
});

// ── 跨仓契约 ──
const BACKEND_ROOT = path.join(root, '..', 'circle_be');
const hasBackend = fs.existsSync(path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'));

test(
  'the backend exposes the alias endpoint and returns alias in the member DTO',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const controller = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'),
      'utf8',
    );
    assert.match(controller, /@Patch\('conversations\/:id\/my-alias'\)/);
    const types = fs.readFileSync(path.join(BACKEND_ROOT, 'src/chat/chat.types.ts'), 'utf8');
    const block = types.match(/export interface ChatMemberDto \{([\s\S]*?)\n\}/);
    assert.ok(block, 'backend has no ChatMemberDto');
    assert.match(block[1], /alias: string \| null;/);
    const schema = fs.readFileSync(path.join(BACKEND_ROOT, 'prisma/schema.prisma'), 'utf8');
    assert.match(schema, /alias\s+String\?/);
  },
);
