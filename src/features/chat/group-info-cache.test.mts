import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evictGroupInfoCache,
  readGroupInfoCache,
  writeGroupInfoCache,
} from './group-info-cache.ts';

const member = (userId: string) => ({ userId }) as never;

test('a second visit reads back what the first one loaded', () => {
  writeGroupInfoCache(1, 'circle:a', {
    groupInfo: { name: '圈 A', notice: '公告', memberCount: 2 },
  });
  writeGroupInfoCache(1, 'circle:a', { members: [member('u1'), member('u2')] });
  const hit = readGroupInfoCache(1, 'circle:a');
  assert.equal(hit?.groupInfo?.name, '圈 A');
  assert.equal(hit?.members?.length, 2);
});

test('switching account drops every cached group', () => {
  writeGroupInfoCache(1, 'circle:b', { members: [member('u1')] });
  assert.equal(readGroupInfoCache(2, 'circle:b'), undefined);
  // 切回旧账号也不复活:epoch 一变整份清空。
  assert.equal(readGroupInfoCache(1, 'circle:b'), undefined);
});

test('evicting one group leaves the others', () => {
  writeGroupInfoCache(3, 'circle:c', { members: [member('u1')] });
  writeGroupInfoCache(3, 'circle:d', { members: [member('u2')] });
  evictGroupInfoCache(3, 'circle:c');
  assert.equal(readGroupInfoCache(3, 'circle:c'), undefined);
  assert.equal(readGroupInfoCache(3, 'circle:d')?.members?.length, 1);
});

test('only the most recently viewed groups are kept', () => {
  for (let i = 0; i < 25; i += 1) {
    writeGroupInfoCache(4, `circle:${i}`, { members: [] });
  }
  assert.equal(readGroupInfoCache(4, 'circle:0'), undefined);
  assert.ok(readGroupInfoCache(4, 'circle:24'));
});
