import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNC_LIVE_WINDOW,
  advanceRevisionCursor,
  orderSyncTargets,
  planConversationSync,
} from './sync-plan.ts';

test('planConversationSync: nothing to do once the local cursor reached the server', () => {
  assert.deepEqual(
    planConversationSync({ localRevision: 9, targetRevision: 9, hasLocalMessages: true }),
    { kind: 'up-to-date' },
  );
  // 快照比本地游标旧是常态竞态:快照请求在途时,实时事件已经把游标推过了它。
  // 不能因此作废缓存,也不能让游标后退。
  assert.deepEqual(
    planConversationSync({ localRevision: 12, targetRevision: 9, hasLocalMessages: true }),
    { kind: 'up-to-date' },
  );
});

test('planConversationSync: a conversation with no local copy just adopts the server position', () => {
  // 新装机/从没打开过:没有缓存要对账,逐页拉整段历史纯属浪费,打开时再拉最新一页。
  assert.deepEqual(
    planConversationSync({ localRevision: 0, targetRevision: 480, hasLocalMessages: false }),
    { kind: 'adopt', revision: 480 },
  );
});

test('planConversationSync: small gaps are pulled, large ones jump to the latest window', () => {
  assert.deepEqual(
    planConversationSync({ localRevision: 100, targetRevision: 100 + SYNC_LIVE_WINDOW, hasLocalMessages: true }),
    { kind: 'pull', from: 100, to: 100 + SYNC_LIVE_WINDOW },
  );
  // 落后太多的热群:逐页追一千条以上只会把首屏拖住,旧缓存作废、按最新一页重来。
  assert.deepEqual(
    planConversationSync({ localRevision: 100, targetRevision: 101 + SYNC_LIVE_WINDOW, hasLocalMessages: true }),
    { kind: 'jump', revision: 101 + SYNC_LIVE_WINDOW },
  );
});

test('orderSyncTargets: only stale conversations, the open one first', () => {
  const local = new Map([
    ['a', 5],
    ['b', 3],
    ['c', 7],
  ]);
  assert.deepEqual(
    orderSyncTargets(
      [
        { id: 'a', syncRevision: 5 },
        { id: 'b', syncRevision: 4 },
        { id: 'c', syncRevision: 9 },
        { id: 'd', syncRevision: 2 },
        { id: 'e' },
      ],
      local,
      'c',
    ),
    [
      { id: 'c', target: 9 },
      { id: 'b', target: 4 },
      { id: 'd', target: 2 },
    ],
  );
});

test('advanceRevisionCursor: contiguous revisions move the cursor', () => {
  const step = advanceRevisionCursor(4, new Set(), 5);
  assert.equal(step.cursor, 5);
  assert.equal(step.gap, false);
});

test('advanceRevisionCursor: a hole holds the cursor until it is filled, in any order', () => {
  // 两个并发事务提交顺序与广播到达顺序可以相反:7 先到、6 后到。
  const first = advanceRevisionCursor(5, new Set(), 7);
  assert.equal(first.cursor, 5);
  assert.equal(first.gap, true);
  const second = advanceRevisionCursor(first.cursor, first.pendingAbove, 6);
  assert.equal(second.cursor, 7);
  assert.equal(second.gap, false);
  assert.equal(second.pendingAbove.size, 0);
});

test('advanceRevisionCursor: stale and duplicate revisions change nothing', () => {
  const pending = new Set([9]);
  const step = advanceRevisionCursor(6, pending, 6);
  assert.equal(step.cursor, 6);
  assert.deepEqual([...step.pendingAbove], [9]);
  assert.equal(step.gap, true);
});
