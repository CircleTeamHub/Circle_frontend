import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveredCatchUpReports } from './delivered-catch-up.ts';

// 后台断开期间收到的消息只走了推送;重连对账时要补报「已送达」,否则对方一直看到
// 「已发送」,直到这边点开会话变成「已读」。口径与实时收消息时一致:只报单聊、
// 只报别人发的、只报这次真的新到的。
const conversation = (
  id: string,
  type: 'DIRECT' | 'GROUP',
  last: { height: number; senderId: string | null } | null,
  lastMessageAt: string | null = null,
) => ({
  id,
  type,
  lastMessage: last
    ? { height: last.height, sender: last.senderId ? { id: last.senderId } : null }
    : null,
  lastMessageAt,
});

test('reports direct conversations whose latest message from the peer is new', () => {
  const reports = deliveredCatchUpReports(
    new Map([['dm-1', 3]]),
    [conversation('dm-1', 'DIRECT', { height: 7, senderId: 'peer' })],
    'me',
  );
  assert.deepEqual(reports, [{ conversationId: 'dm-1', height: 7 }]);
});

test('skips groups, own messages, system messages and nothing new', () => {
  const reports = deliveredCatchUpReports(
    new Map([
      ['dm-same', 7],
      ['dm-own', 1],
      ['dm-system', 1],
      ['group', 1],
    ]),
    [
      conversation('dm-same', 'DIRECT', { height: 7, senderId: 'peer' }),
      conversation('dm-own', 'DIRECT', { height: 9, senderId: 'me' }),
      conversation('dm-system', 'DIRECT', { height: 9, senderId: null }),
      conversation('group', 'GROUP', { height: 9, senderId: 'peer' }),
      conversation('dm-empty', 'DIRECT', null),
    ],
    'me',
  );
  assert.deepEqual(reports, []);
});

test('a conversation never seen locally counts as new', () => {
  const reports = deliveredCatchUpReports(
    new Map(),
    [conversation('dm-new', 'DIRECT', { height: 2, senderId: 'peer' })],
    'me',
  );
  assert.deepEqual(reports, [{ conversationId: 'dm-new', height: 2 }]);
});

test('caps the batch to the most recently active conversations', () => {
  // 服务端送达限流每人 10 秒 30 次、超出静默丢弃,实时送达也走同一份额度。
  const snapshot = Array.from({ length: 5 }, (_, index) =>
    conversation(
      `dm-${index}`,
      'DIRECT',
      { height: 3, senderId: 'peer' },
      `2026-10-24T00:00:0${index}.000Z`,
    ),
  );
  const reports = deliveredCatchUpReports(new Map(), snapshot, 'me', 2);
  assert.deepEqual(
    reports.map((report) => report.conversationId),
    ['dm-4', 'dm-3'],
  );
});
