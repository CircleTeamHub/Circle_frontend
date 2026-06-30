import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLocalUnreadOverrides,
  countLocalUnreadOverrides,
  setLocalUnreadOverride,
  clearLocalUnreadOverride,
  type LocalUnreadOverrides,
} from './local-unread.ts';

const baseConversation = {
  id: 'conv-1',
  sourceID: 'user-1',
  name: 'Alice',
  message: 'hello',
  time: '10:00',
  unreadCount: 0,
  conversationType: 'private' as const,
  pinned: false,
  muted: false,
};

test('setLocalUnreadOverride marks a conversation unread without mutating input', () => {
  const overrides: LocalUnreadOverrides = {};
  const result = setLocalUnreadOverride(overrides, 'conv-1');

  assert.deepEqual(overrides, {});
  assert.equal(result['conv-1'], true);
});

test('clearLocalUnreadOverride removes only the target conversation', () => {
  const result = clearLocalUnreadOverride({ 'conv-1': true, 'conv-2': true }, 'conv-1');

  assert.deepEqual(result, { 'conv-2': true });
});

test('applyLocalUnreadOverrides shows local unread as one badge when SDK count is zero', () => {
  const [result] = applyLocalUnreadOverrides([baseConversation], { 'conv-1': true });

  assert.equal(result.unreadCount, 1);
  assert.equal(result.localUnread, true);
});

test('applyLocalUnreadOverrides preserves real SDK unread counts', () => {
  const [result] = applyLocalUnreadOverrides(
    [{ ...baseConversation, unreadCount: 3 }],
    { 'conv-1': true },
  );

  assert.equal(result.unreadCount, 3);
  assert.equal(result.localUnread, true);
});

test('countLocalUnreadOverrides counts only conversations without real unread', () => {
  const count = countLocalUnreadOverrides(
    [
      { ...baseConversation, id: 'conv-1', unreadCount: 0 },
      { ...baseConversation, id: 'conv-2', unreadCount: 2 },
    ],
    { 'conv-1': true, 'conv-2': true, missing: true },
  );

  assert.equal(count, 1);
});
