const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const { resolveNoteCardButtons } = loadTsModule('src/features/notes/utils/note-card-peers.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));
const groupSource = {
  conversationType: 'group',
  conversationID: 'conv-g',
  clientMsgID: 'msg-1',
  sender: { id: 'sender', name: '发送者', faceURL: null },
  group: { id: 'src-group', name: '来源群', faceURL: 'g.jpg' },
};

test('自己写的笔记：底部按钮就是编辑器里添加的个人名片和群名片', () => {
  const result = plain(resolveNoteCardButtons({
    collectedFrom: null,
    cardPreview: {
      contacts: [{ id: 'u1', name: '小王', faceURL: 'u1.jpg' }, { id: 'u2', name: '小李' }],
      groups: [{ id: 'g1', name: '玫瑰刺群', faceURL: null }],
    },
  }));
  assert.deepEqual(result, {
    contact: { id: 'u1', name: '小王', faceURL: 'u1.jpg', target: 'chat' },
    // 不是收藏来源、也不是独立群：圈子群名片进圈子详情（与详情页同口径）。
    group: { id: 'g1', name: '玫瑰刺群', faceURL: null, target: 'circle' },
  });
});

test('收藏来的笔记：名片与来源一致时带上原会话和原消息，进群直接定位', () => {
  const result = plain(resolveNoteCardButtons({
    collectedFrom: groupSource,
    cardPreview: {
      contacts: [{ id: 'sender', name: '发送者' }],
      groups: [{ id: 'src-group', name: '来源群', faceURL: 'g.jpg' }],
    },
  }));
  assert.deepEqual(result.group, {
    id: 'src-group', name: '来源群', faceURL: 'g.jpg', target: 'chat', conversationID: 'conv-g', clientMsgID: 'msg-1',
  });
  // 群里收藏的：发送者不是这条群会话的私聊对象，不能把群会话 id 当私聊带过去。
  assert.deepEqual(result.contact, { id: 'sender', name: '发送者', faceURL: null, target: 'chat' });
});

test('收藏来的笔记没有名片时，默认用来源发送方和来源群（两个按钮各自回退）', () => {
  const none = plain(resolveNoteCardButtons({ collectedFrom: groupSource, cardPreview: { contacts: [], groups: [] } }));
  assert.equal(none.contact.id, 'sender');
  assert.deepEqual(none.group, { id: 'src-group', name: '来源群', faceURL: 'g.jpg', target: 'chat', conversationID: 'conv-g', clientMsgID: 'msg-1' });

  // 只加了个人名片：左边用名片，右边仍回退到来源群。
  const partial = plain(resolveNoteCardButtons({
    collectedFrom: groupSource,
    cardPreview: { contacts: [{ id: 'u9', name: '新名片' }], groups: [] },
  }));
  assert.equal(partial.contact.id, 'u9');
  assert.equal(partial.group.id, 'src-group');
});

test('私聊收藏来的笔记只有发送方，没有群按钮', () => {
  const result = plain(resolveNoteCardButtons({
    collectedFrom: { conversationType: 'private', conversationID: 'conv-p', clientMsgID: 'm', sender: { id: 'friend', name: '好友' } },
    cardPreview: { contacts: [], groups: [] },
  }));
  assert.deepEqual(result, { contact: { id: 'friend', name: '好友', faceURL: null, target: 'chat', conversationID: 'conv-p' }, group: null });
});

test('自己写的笔记没有名片就不展示按钮', () => {
  assert.deepEqual(plain(resolveNoteCardButtons({ collectedFrom: null, cardPreview: { contacts: [], groups: [] } })), { contact: null, group: null });
});

test('缺 id 或名称的坏数据跳过，取下一个有效名片', () => {
  const result = plain(resolveNoteCardButtons({
    cardPreview: { contacts: [{ id: '', name: 'x' }, { id: 'u2', name: '小李' }], groups: [{ id: 'g', name: '' }] },
  }));
  assert.equal(result.contact.id, 'u2');
  assert.equal(result.group, null);
});

test('独立群名片带服务端标注的会话 id：按会话进群（卡片 id 不是圈子 id）', () => {
  const result = plain(resolveNoteCardButtons({
    collectedFrom: null,
    cardPreview: { contacts: [], groups: [{ id: 'conv-uuid', name: '独立群', conversationID: 'conv-uuid' }] },
  }));
  assert.deepEqual(result.group, { id: 'conv-uuid', name: '独立群', faceURL: null, target: 'chat', conversationID: 'conv-uuid' });
  // 圈子群名片没有 conversationID：维持按圈子进群。
  const circle = plain(resolveNoteCardButtons({ cardPreview: { contacts: [], groups: [{ id: 'circle-1', name: '圈子群' }] } }));
  assert.equal(circle.group.conversationID, undefined);
});

test('名片就是收藏来源群时，仍以来源会话和原消息为准', () => {
  const result = plain(resolveNoteCardButtons({
    collectedFrom: groupSource,
    cardPreview: { contacts: [], groups: [{ id: 'src-group', name: '来源群', conversationID: 'conv-g' }] },
  }));
  assert.deepEqual(result.group, { id: 'src-group', name: '来源群', faceURL: null, target: 'chat', conversationID: 'conv-g', clientMsgID: 'msg-1' });
});

test('旧版圈子群名片（id 是 OpenIM groupID）按服务端给的规范圈子 id 进群', () => {
  const result = plain(resolveNoteCardButtons({
    cardPreview: { contacts: [], groups: [{ id: 'legacy-group-id', circleId: 'circle-uuid', name: '老圈子', conversationID: null }] },
  }));
  assert.equal(result.group.id, 'circle-uuid');
  assert.equal(result.group.conversationID, undefined);
  // 收藏来源记的是规范圈子 id 时也认得出是同一个群，照样带原消息。
  const collected = plain(resolveNoteCardButtons({
    collectedFrom: { ...groupSource, group: { id: 'circle-uuid', name: '老圈子' } },
    cardPreview: { contacts: [], groups: [{ id: 'legacy-group-id', circleId: 'circle-uuid', name: '老圈子' }] },
  }));
  assert.equal(collected.group.clientMsgID, 'msg-1');
});

test('收藏副本的群名片不是收藏来源群时进圈子详情，不直接进群聊（收藏者未必在那个群里）', () => {
  const result = plain(resolveNoteCardButtons({
    collectedFrom: groupSource,
    cardPreview: { contacts: [], groups: [{ id: 'boss-circle', name: '老板的圈子', conversationID: null }] },
  }));
  assert.equal(result.group.target, 'circle');
  assert.equal(result.group.conversationID, undefined);
  assert.equal(result.group.clientMsgID, undefined);
});
