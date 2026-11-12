import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUPLICATE_NAVIGATION_WINDOW_MS,
  installNavigationDedupe,
} from './navigation-dedupe.ts';

function fakeRouter() {
  const calls: { method: string; href: unknown }[] = [];
  const router = {
    push: (href: unknown) => { calls.push({ method: 'push', href }); },
    navigate: (href: unknown) => { calls.push({ method: 'navigate', href }); },
    replace: (href: unknown) => { calls.push({ method: 'replace', href }); },
  };
  return { router, calls };
}

const chat = { pathname: '/(tabs)/discover/chat-detail', params: { sourceID: 'u1', conversationID: 'c1' } };

test('a double tap on the same target pushes once', () => {
  const { router, calls } = fakeRouter();
  let clock = 1_000;
  installNavigationDedupe(router as never, () => clock);
  router.push(chat);
  clock += 120;
  router.push({ ...chat, params: { ...chat.params } });
  assert.deepEqual(calls.map((call) => call.method), ['push']);
});

test('the same target is allowed again once the window has passed', () => {
  const { router, calls } = fakeRouter();
  let clock = 1_000;
  installNavigationDedupe(router as never, () => clock);
  router.push(chat);
  clock += DUPLICATE_NAVIGATION_WINDOW_MS;
  router.push(chat);
  assert.equal(calls.length, 2);
});

test('different targets, replace and string hrefs are not blocked', () => {
  const { router, calls } = fakeRouter();
  const clock = 1_000;
  installNavigationDedupe(router as never, () => clock);
  router.push(chat);
  router.push({ ...chat, params: { sourceID: 'u2', conversationID: 'c2' } });
  router.replace(chat);
  router.navigate('/(tabs)/messages');
  router.navigate('/(tabs)/messages');
  assert.deepEqual(
    calls.map((call) => call.method),
    ['push', 'push', 'replace', 'navigate'],
  );
});

test('installing twice (Fast Refresh) does not double-wrap', () => {
  const { router, calls } = fakeRouter();
  let clock = 1_000;
  installNavigationDedupe(router as never, () => clock);
  installNavigationDedupe(router as never, () => clock);
  router.push(chat);
  clock += DUPLICATE_NAVIGATION_WINDOW_MS;
  router.push(chat);
  assert.equal(calls.length, 2);
});
