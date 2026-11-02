import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLocalMessageId,
  LOCAL_MESSAGE_ID_PREFIX,
  messageRowKey,
} from './local-message-id.ts';

test('recognises the optimistic ids client.ts mints', () => {
  assert.equal(LOCAL_MESSAGE_ID_PREFIX, 'local:');
  assert.equal(isLocalMessageId('local:d-1'), true);
  assert.equal(isLocalMessageId('local:'), true);
});

test('treats server ids and missing ids as not local', () => {
  assert.equal(isLocalMessageId('cm5abc123'), false);
  // 前缀必须在开头:服务端 id 里恰好含有 "local:" 不该被当成乐观消息。
  assert.equal(isLocalMessageId('msg-local:1'), false);
  assert.equal(isLocalMessageId(''), false);
  assert.equal(isLocalMessageId(null), false);
  assert.equal(isLocalMessageId(undefined), false);
});

test('row key survives the optimistic → acked id swap', () => {
  // ack 前后同一条消息:id 从 local:<d> 换成服务端真 id,d 不变。key 跟着 id 变
  // 的话 FlatList 会整行卸载重挂 —— 头像图片重新加载,每发一条消息就闪一下。
  const optimistic = { id: 'local:d-1', deliveryId: 'd-1' };
  const acked = { id: 'cm5abc123', deliveryId: 'd-1' };
  assert.equal(messageRowKey(optimistic), messageRowKey(acked));
});

test('row key falls back to id when there is no delivery id', () => {
  assert.equal(messageRowKey({ id: 'cm5abc123' }), 'cm5abc123');
  // 带 d 的 key 有 d: 前缀,不会和另一条消息的裸 id 撞上。
  assert.notEqual(
    messageRowKey({ id: 'x', deliveryId: 'cm5abc123' }),
    messageRowKey({ id: 'cm5abc123' }),
  );
});
