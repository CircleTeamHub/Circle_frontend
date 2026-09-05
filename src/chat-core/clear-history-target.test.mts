import assert from 'node:assert/strict';
import test from 'node:test';

import { getKnownClearTargetHeight } from './clear-history-target.ts';

test('uses the highest confirmed conversation or timeline height', () => {
  assert.equal(
    getKnownClearTargetHeight(
      { lastMessage: { height: 42 } },
      [{ height: 39 }, { height: 41 }],
    ),
    42,
  );
  assert.equal(
    getKnownClearTargetHeight(
      { lastMessage: { height: 40 } },
      [{ height: 43 }, { height: 41 }],
    ),
    43,
  );
});

test('omits the target when no trustworthy height is available', () => {
  assert.equal(
    getKnownClearTargetHeight(
      { lastMessage: null },
      [{ height: Number.POSITIVE_INFINITY }, { height: -1 }],
    ),
    undefined,
  );
});

// 服务端把 targetHeight 0 当成「clearThrough <= 0」直接返回，一条都不清，
// 而客户端照样清空本地并提示成功。乐观消息的 height 是 0，所以只有它们时
// 必须报告「不知道」，让服务端退回到会话当前顶端。
test('treats optimistic zero heights as unknown rather than as a watermark', () => {
  assert.equal(
    getKnownClearTargetHeight({ lastMessage: null }, [{ height: 0 }, { height: 0 }]),
    undefined,
  );
  assert.equal(
    getKnownClearTargetHeight({ lastMessage: { height: 0 } }, [{ height: 7 }]),
    7,
  );
});
