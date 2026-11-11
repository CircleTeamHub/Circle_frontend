import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentRoute } from './current-route.ts';

const signups = (postId: string) => ({
  pathname: '/(tabs)/messages/post-signups',
  params: { postId, title: '周末徒步' },
});

test('a signup for the post whose list is open targets the current page', () => {
  const current = { pathname: '/messages/post-signups', params: { postId: 'p1', title: '旧标题' } };
  assert.equal(isCurrentRoute(current, signups('p1')), true);
  assert.equal(isCurrentRoute(current, signups('p2')), false);
});

test('the same screen in another tab stack is a different page', () => {
  const current = { pathname: '/discover/post-signups', params: { postId: 'p1' } };
  assert.equal(isCurrentRoute(current, signups('p1')), false);
});

// expo-router 55 的 usePathname 用解码后的原值拼动态段（routeInfo.js），不会是 %20 这种形状。
test('dynamic segments compare the raw id that usePathname reports', () => {
  const profile = { pathname: '/(tabs)/messages/user/[id]', params: { id: 'user / 8', name: '小王' } };
  assert.equal(isCurrentRoute({ pathname: '/messages/user/user / 8', params: { id: 'user / 8' } }, profile), true);
  assert.equal(isCurrentRoute({ pathname: '/messages/user/someone-else', params: { id: 'someone-else' } }, profile), false);
});

test('a chat is identified by its source, not by the message it jumps to', () => {
  const current = {
    pathname: '/messages/chat-detail',
    params: { sourceID: 'peer-1', title: '小王' },
  };
  const chat = (sourceID: string) => ({
    pathname: '/(tabs)/messages/chat-detail',
    params: { conversationID: 'si_me_peer', sourceID, conversationType: 'private', searchedMsgID: 'm9' },
  });
  assert.equal(isCurrentRoute(current, chat('peer-1')), true);
  assert.equal(isCurrentRoute(current, chat('peer-2')), false);
});

test('the notification list fallback matches the list it lands on', () => {
  assert.equal(
    isCurrentRoute({ pathname: '/messages/notifications', params: {} }, '/(tabs)/messages/notifications'),
    true,
  );
  const circleBell = { pathname: '/discover/notification-center', params: { domain: 'circle' } };
  const fallback = (domain: string) => ({ pathname: '/(tabs)/discover/notification-center', params: { domain } });
  assert.equal(isCurrentRoute(circleBell, fallback('circle')), true);
  assert.equal(isCurrentRoute(circleBell, fallback('moments')), false);
});
