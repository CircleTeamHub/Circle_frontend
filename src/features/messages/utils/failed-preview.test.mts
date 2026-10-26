import test from 'node:test';
import assert from 'node:assert/strict';
import type { StoredChatMessage } from '@/chat-core/store';
import { selectFailedConversationKey } from './failed-preview.ts';

function message(fields: Partial<StoredChatMessage>): StoredChatMessage {
  return { id: 'm', height: 0, ...fields } as StoredChatMessage;
}

const delivered = (height: number) => message({ id: `ok-${height}`, height });
const failedAfter = (failedAfterHeight: number) =>
  message({ id: `fail-${failedAfterHeight}`, failed: true, failedAfterHeight });

function stateOf(messagesByConversation: Record<string, StoredChatMessage[]>) {
  return { messagesByConversation };
}

test('lists conversations whose latest send attempt failed, sorted and joined', () => {
  const key = selectFailedConversationKey(
    stateOf({
      'conv-b': [delivered(3), failedAfter(3)],
      'conv-a': [delivered(1), failedAfter(1)],
      'conv-ok': [delivered(5)],
      // 失败之后又有消息落库:前缀应撤掉。
      'conv-recovered': [failedAfter(1), delivered(2)],
    }),
  );
  assert.equal(key, 'conv-a\nconv-b');
});

test('an unchanged message array is not rescanned on later store writes', () => {
  // 会话列表的 selector 在每次 chat store 写入时都会跑(包括「正在输入」「已送达」
  // 这类高频小事件)。store 是不可变更新,没变的会话引用不变,判定直接复用 ——
  // 否则 100 个群、几千条内存消息,每个小事件都要全量扫一遍。
  const quiet = [delivered(1)];
  const busy = [delivered(1)];
  assert.equal(selectFailedConversationKey(stateOf({ quiet, busy })), '');

  // 原地改动不会被看见:证明 quiet 这次走的是缓存,没有重扫。
  quiet.push(failedAfter(1));
  const busyNext = [...busy, failedAfter(1)];
  assert.equal(
    selectFailedConversationKey(stateOf({ quiet, busy: busyNext })),
    'busy',
  );
});

test('a replaced message array is re-evaluated', () => {
  const before = [delivered(1), failedAfter(1)];
  assert.equal(selectFailedConversationKey(stateOf({ conv: before })), 'conv');

  const after = [...before, delivered(2)];
  assert.equal(selectFailedConversationKey(stateOf({ conv: after })), '');
});
