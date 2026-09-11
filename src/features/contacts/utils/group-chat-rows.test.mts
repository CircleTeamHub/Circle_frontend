import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterGroupChatRows,
  selectGroupConversations,
} from './group-chat-rows.ts';

const conversation = (
  id: string,
  type: string,
  joinedAt: string | null,
  lastMessageAt: string | null = null,
) => ({ id, type, joinedAt, lastMessageAt });

test('only group conversations make the list', () => {
  const rows = selectGroupConversations([
    conversation('d1', 'DIRECT', '2026-09-09T00:00:00.000Z'),
    conversation('g1', 'GROUP', '2026-09-01T00:00:00.000Z'),
    conversation('t1', 'TEMP', '2026-09-08T00:00:00.000Z'),
    conversation('s1', 'SUPPORT', '2026-09-07T00:00:00.000Z'),
  ]);

  assert.deepEqual(rows.map((row) => row.id), ['g1']);
});

test('the group I joined most recently comes first', () => {
  const rows = selectGroupConversations([
    conversation('old', 'GROUP', '2026-06-01T00:00:00.000Z'),
    conversation('new', 'GROUP', '2026-09-09T00:00:00.000Z'),
    conversation('mid', 'GROUP', '2026-08-01T00:00:00.000Z'),
  ]);

  assert.deepEqual(rows.map((row) => row.id), ['new', 'mid', 'old']);
});

// 老后端不返回 joinedAt。那时按最后活跃时间排，总比把顺序打乱强。
test('a group without joinedAt falls back to its last message time', () => {
  const rows = selectGroupConversations([
    conversation('a', 'GROUP', null, '2026-09-05T00:00:00.000Z'),
    conversation('b', 'GROUP', null, '2026-09-09T00:00:00.000Z'),
  ]);

  assert.deepEqual(rows.map((row) => row.id), ['b', 'a']);
});

test('a group with neither timestamp sinks to the bottom instead of throwing', () => {
  const rows = selectGroupConversations([
    conversation('blank', 'GROUP', null, null),
    conversation('dated', 'GROUP', '2026-01-01T00:00:00.000Z'),
  ]);

  assert.deepEqual(rows.map((row) => row.id), ['dated', 'blank']);
});

test('an empty or whitespace query returns the rows untouched', () => {
  const rows = [{ name: '读书会' }, { name: 'Weekend Hike' }];

  assert.equal(filterGroupChatRows(rows, ''), rows);
  assert.equal(filterGroupChatRows(rows, '   '), rows);
});

test('the query matches the group name, case-insensitively', () => {
  const rows = [{ name: '读书会' }, { name: 'Weekend Hike' }];

  assert.deepEqual(filterGroupChatRows(rows, '读书'), [{ name: '读书会' }]);
  assert.deepEqual(filterGroupChatRows(rows, 'WEEKEND'), [{ name: 'Weekend Hike' }]);
  assert.deepEqual(filterGroupChatRows(rows, 'zzz'), []);
});

// 副标题（群公告 / 加入时间）也在行上，搜得到才算数。
test('the query also matches the subtitle the row renders', () => {
  const rows = [
    { name: '读书会', subtitle: '每周三晚上' },
    { name: 'Weekend Hike', subtitle: null },
  ];

  assert.deepEqual(
    filterGroupChatRows(rows, '每周三').map((row) => row.name),
    ['读书会'],
  );
  assert.deepEqual(filterGroupChatRows(rows, 'hike').map((row) => row.name), [
    'Weekend Hike',
  ]);
});
