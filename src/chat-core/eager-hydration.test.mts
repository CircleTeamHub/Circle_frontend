import test from 'node:test';
import assert from 'node:assert/strict';
import { pickEagerTimelineIds } from './eager-hydration.ts';

const conversation = (id: string, lastMessageAt: string | null, pinned = false) => ({
  id,
  pinned,
  lastMessageAt,
});

test('cold start loads timelines only for the most recently active conversations', () => {
  // 300 个群的话,原来冷启动要串行读 300 次本地库、灌上万条消息进内存。
  // 其余会话在打开时由 loadChatHistory 从本地库补读,不会空白。
  const ids = pickEagerTimelineIds(
    [
      conversation('old', '2026-01-01T00:00:00.000Z'),
      conversation('newest', '2026-10-01T00:00:00.000Z'),
      conversation('middle', '2026-05-01T00:00:00.000Z'),
      conversation('never', null),
    ],
    { limit: 2, mustInclude: new Set() },
  );
  assert.deepEqual([...ids].sort(), ['middle', 'newest']);
});

test('pinned conversations count as most recent, like the list order', () => {
  const ids = pickEagerTimelineIds(
    [
      conversation('pinned-old', '2025-01-01T00:00:00.000Z', true),
      conversation('recent', '2026-10-01T00:00:00.000Z'),
      conversation('older', '2026-01-01T00:00:00.000Z'),
    ],
    { limit: 2, mustInclude: new Set() },
  );
  assert.deepEqual([...ids].sort(), ['pinned-old', 'recent']);
});

test('conversations that must be hydrated are always included beyond the limit', () => {
  // 有待发消息的会话要靠时间线判断「其实已经发出去了」;末条被本地删掉的会话
  // 要靠时间线找回上一条做预览 —— 这两类无论多旧都得预载。
  const ids = pickEagerTimelineIds(
    [
      conversation('recent', '2026-10-01T00:00:00.000Z'),
      conversation('ancient-with-outbox', '2020-01-01T00:00:00.000Z'),
    ],
    { limit: 1, mustInclude: new Set(['ancient-with-outbox']) },
  );
  assert.deepEqual([...ids].sort(), ['ancient-with-outbox', 'recent']);
});
