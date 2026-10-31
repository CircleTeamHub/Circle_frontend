const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// 群聊信息/群管理/入群申请回到前台时据此判断能不能跳过重拉:群相关的写请求(两种群的
// 成员、角色、禁言、公告、头像、策略、转让、审批…)成功后都要记一笔,读请求不算。
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function functionBody(source, name) {
  const start = source.search(new RegExp(`export (async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  const next = source.slice(start + 1).search(/\nexport /);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

test('group writes mark group data stale; nothing marks it before a write', async () => {
  const marker = loadTsModule('src/services/api/group-writes.ts');
  const before = Date.now();
  assert.equal(marker.groupsMutatedSince(before), false);
  await marker.markGroupWrite(Promise.resolve('ok'));
  assert.equal(marker.groupsMutatedSince(before), true);
});

test('a failed group write does not count as a change', async () => {
  const marker = loadTsModule('src/services/api/group-writes.ts');
  const before = Date.now();
  await assert.rejects(marker.markGroupWrite(Promise.reject(new Error('nope'))));
  assert.equal(marker.groupsMutatedSince(before), false);
});

test('every group write in the chat API goes through the marker; get-or-create does not', () => {
  const source = read('src/chat-core/api.ts');
  for (const name of [
    'createGroupChatConversation',
    'inviteGroupChatMembers',
    'leaveGroupChatConversation',
    'dissolveGroupChatConversation',
    'renameGroupChatConversation',
    'setGroupChatMemberRole',
    'removeGroupChatMember',
    'silenceChatMember',
    'unsilenceChatMember',
    'setMyGroupChatRemark',
    'setMyGroupChatAlias',
    'setGroupChatMuteAll',
    'transferGroupChatOwner',
    'setGroupChatNotice',
    'setGroupChatAvatar',
    'updateGroupChatPolicies',
  ]) {
    assert.match(functionBody(source, name), /markGroupWrite\(\s*apiClient/, `${name} must be marked`);
  }
  // 群聊信息页每次聚焦都会调 createCircleChatConversation(取或建);记成写请求的话闸门永远不放行。
  for (const name of ['createDirectChatConversation', 'createCircleChatConversation']) {
    assert.doesNotMatch(functionBody(source, name), /markGroupWrite/, `${name} is get-or-create, not a change`);
  }
});

test('circle-group member writes and admission writes go through the marker', () => {
  const groups = read('src/services/api/groups.ts');
  for (const name of ['leaveGroup', 'inviteGroupMembers', 'removeGroupMember', 'updateGroupMemberRole']) {
    assert.match(functionBody(groups, name), /markGroupWrite\(\s*apiClient/, `${name} must be marked`);
  }
  assert.doesNotMatch(functionBody(groups, 'reportGroup'), /markGroupWrite/);

  const admissions = read('src/services/api/group-admissions.ts');
  for (const name of ['applyToGroup', 'actOnGroupAdmission', 'acceptGroupQrInvitation', 'markGroupAdmissionSeen']) {
    assert.match(functionBody(admissions, name), /markGroupWrite\(\s*apiClient/, `${name} must be marked`);
  }
});
