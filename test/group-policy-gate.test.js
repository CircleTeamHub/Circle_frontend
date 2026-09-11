const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// 「成员可查看他人资料」/「成员可邀请」这两个开关**只在客户端拦**(资料接口没有
// 群上下文)。所以判据必须只有一份:哪一处漏用,那一处就是绕过 —— 成员搜索页
// 曾对圈子群直接 `return true`,于是「群信息 → 群成员 → 点人」整条路绕开了开关。
const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadGate() {
  const permissions = loadTsModule('src/features/chat/group-admin-permissions.ts');
  return loadTsModule('src/features/chat/utils/group-policy.ts', {
    requireShim: (request) => {
      if (request === '@/features/chat/group-admin-permissions') return permissions;
      throw new Error(`unexpected require: ${request}`);
    },
  });
}

const OPEN = {
  memberCanInvite: true,
  qrJoinEnabled: true,
  membersCanViewRoster: true,
  membersCanViewProfiles: true,
  membersCanAddFriends: true,
};
const CLOSED = { ...OPEN, memberCanInvite: false, membersCanViewProfiles: false };

test('ordinary members are blocked when the switch is off, managers never are', () => {
  const { allowsMemberProfiles, allowsMemberInvites } = loadGate();

  assert.equal(allowsMemberProfiles({ role: 'MEMBER', policies: CLOSED }), false);
  assert.equal(allowsMemberProfiles({ role: 'OWNER', policies: CLOSED }), true);
  assert.equal(allowsMemberProfiles({ role: 'ADMIN', policies: CLOSED }), true);
  assert.equal(allowsMemberProfiles({ role: 'MEMBER', policies: OPEN }), true);

  assert.equal(allowsMemberInvites({ role: 'MEMBER', policies: CLOSED }), false);
  assert.equal(allowsMemberInvites({ role: 'ADMIN', policies: CLOSED }), true);
  assert.equal(allowsMemberInvites({ role: 'MEMBER', policies: OPEN }), true);
});

test('an unknown role is treated as an ordinary member, not as a manager', () => {
  const { allowsMemberProfiles } = loadGate();

  assert.equal(allowsMemberProfiles({ role: null, policies: CLOSED }), false);
  assert.equal(allowsMemberProfiles({ policies: CLOSED }), false);
});

test('a missing policy block (old backend) stays open instead of locking everyone out', () => {
  const { allowsMemberProfiles, allowsMemberInvites } = loadGate();

  // 这些开关都是收紧型的:缺省收紧会把老后端上的每个普通成员一次锁死。
  assert.equal(allowsMemberProfiles({ role: 'MEMBER' }), true);
  assert.equal(allowsMemberProfiles({ role: 'MEMBER', policies: null }), true);
  assert.equal(allowsMemberInvites({ role: 'MEMBER', policies: null }), true);
});

test('all three screens read the switch through the shared gate', () => {
  const screens = [
    'src/features/chat/screens/ChatInfoScreen.tsx',
    'src/features/chat/screens/ChatDetailScreen.tsx',
    'src/features/chat/screens/SearchGroupMembersScreen.tsx',
  ];
  for (const rel of screens) {
    const source = read(rel);
    assert.match(
      source,
      /allowsMemberProfiles\(/,
      `${rel} does not use the shared gate`,
    );
    // 各自手写 `policies?.membersCanViewProfiles ?? true` 就是判据分叉的起点。
    assert.doesNotMatch(
      source,
      /membersCanViewProfiles \?\? true/,
      `${rel} still hand-rolls the profile switch`,
    );
  }

  // 成员搜索页对圈子群曾经直接放行,这条守住它不再回潮。
  const search = read('src/features/chat/screens/SearchGroupMembersScreen.tsx');
  assert.doesNotMatch(search, /if \(!isStandaloneGroup\) return true;/);
});

test('the invite tile follows the same gate as the QR entry', () => {
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  // 关了「成员邀请」之后普通成员按下必得 CHAT_GROUP_INVITE_DISABLED:收起入口。
  assert.match(info, /allowsMemberInvites\(groupPolicyActor\)/);
  assert.match(info, /\{canInviteGroupMembers \? \(/);
  assert.doesNotMatch(info, /\{canManageGroup \|\| isStandaloneGroup \? \(\s*\n\s*<Pressable style=\{s\.groupMemberCell\}/);
});
