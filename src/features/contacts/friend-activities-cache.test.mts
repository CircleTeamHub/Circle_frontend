import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readFriendActivitiesCache,
  writeFriendActivitiesCache,
} from './friend-activities-cache.ts';

const activity = (id: string) => ({ id }) as never;
const never = () => false;

test('nothing is cached before the first load', () => {
  assert.equal(readFriendActivitiesCache(1, never), null);
});

test('the next visit reads back the last loaded list', () => {
  writeFriendActivitiesCache(2, [activity('a1'), activity('a2')], 100);
  assert.deepEqual(readFriendActivitiesCache(2, never), [
    activity('a1'),
    activity('a2'),
  ]);
});

// 详情页同意/拒绝、发出新申请都记好友写请求:那之后这份列表可能把已处理的申请画回「待处理」。
test('a friend write after the load means the cached list is not used', () => {
  writeFriendActivitiesCache(3, [activity('a1')], 100);
  const seen: number[] = [];
  const mutatedSince = (since: number) => {
    seen.push(since);
    return true;
  };
  assert.equal(readFriendActivitiesCache(3, mutatedSince), null);
  // 按请求发出的时刻判断,不是按写入缓存的时刻。
  assert.deepEqual(seen, [100]);
});

test('switching account drops the previous account list', () => {
  writeFriendActivitiesCache(4, [activity('a1')], 100);
  assert.equal(readFriendActivitiesCache(5, never), null);
  // 切回旧账号也不复活:epoch 一变就丢掉。
  assert.equal(readFriendActivitiesCache(4, never), null);
});
