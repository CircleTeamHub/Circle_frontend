import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evictCircleDetailCache,
  patchCachedCircle,
  readCircleDetailCache,
  writeCircleDetailCache,
} from './circle-detail-cache.ts';

const circle = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: `圈 ${id}`, myStatus: 'ACTIVE', myRole: 'MEMBER', ...extra }) as never;
const invitation = (id: string) => ({ id, status: 'PENDING' }) as never;

test('a second visit reads back the circle and my pending application', () => {
  writeCircleDetailCache(1, 'a', { circle: circle('a') });
  writeCircleDetailCache(1, 'a', { invitation: invitation('inv-a') });
  const hit = readCircleDetailCache(1, 'a');
  assert.equal(hit?.circle?.name, '圈 a');
  assert.equal(hit?.invitation?.id, 'inv-a');
  assert.equal(readCircleDetailCache(1, 'missing'), undefined);
});

test('a later load replaces the circle but keeps the application it did not fetch', () => {
  writeCircleDetailCache(2, 'a', { circle: circle('a'), invitation: invitation('inv-a') });
  writeCircleDetailCache(2, 'a', { circle: circle('a', { myStatus: 'PENDING' }) });
  const hit = readCircleDetailCache(2, 'a');
  assert.equal(hit?.circle?.myStatus, 'PENDING');
  assert.equal(hit?.invitation?.id, 'inv-a');
});

test('switching account drops every cached circle', () => {
  writeCircleDetailCache(3, 'b', { circle: circle('b') });
  assert.equal(readCircleDetailCache(4, 'b'), undefined);
  // 切回旧账号也不复活:epoch 一变整份清空(成员关系是按账号的)。
  assert.equal(readCircleDetailCache(3, 'b'), undefined);
});

test('a local avatar/cover change patches the cached circle in place', () => {
  writeCircleDetailCache(5, 'c', { circle: circle('c', { cover: 'old.jpg' }) });
  patchCachedCircle(5, 'c', { cover: 'new.jpg' });
  const hit = readCircleDetailCache(5, 'c');
  assert.equal(hit?.circle?.cover, 'new.jpg');
  assert.equal(hit?.circle?.name, '圈 c');
});

test('patching a circle that was never cached does not invent a half-filled one', () => {
  patchCachedCircle(6, 'never', { avatarUrl: 'a.jpg' });
  assert.equal(readCircleDetailCache(6, 'never'), undefined);
});

test('evicting one circle leaves the others', () => {
  writeCircleDetailCache(7, 'd', { circle: circle('d') });
  writeCircleDetailCache(7, 'e', { circle: circle('e') });
  evictCircleDetailCache(7, 'd');
  assert.equal(readCircleDetailCache(7, 'd'), undefined);
  assert.equal(readCircleDetailCache(7, 'e')?.circle?.id, 'e');
});

test('only the most recently viewed circles are kept', () => {
  writeCircleDetailCache(8, 'circle:0', { circle: circle('0') });
  for (let i = 1; i < 60; i += 1) {
    writeCircleDetailCache(8, `circle:${i}`, { circle: circle(String(i)) });
    // 一直在看的那个圈子算最近使用,不会被后来的挤掉。
    readCircleDetailCache(8, 'circle:0');
  }
  assert.equal(readCircleDetailCache(8, 'circle:1'), undefined);
  assert.equal(readCircleDetailCache(8, 'circle:0')?.circle?.id, '0');
  assert.equal(readCircleDetailCache(8, 'circle:59')?.circle?.id, '59');
});
