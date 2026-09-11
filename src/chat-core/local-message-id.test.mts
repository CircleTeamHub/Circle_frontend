import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLocalMessageId,
  LOCAL_MESSAGE_ID_PREFIX,
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
