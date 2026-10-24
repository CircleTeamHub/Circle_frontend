import test from 'node:test';
import assert from 'node:assert/strict';
import { reuseUnchanged, structurallyEqual } from './structural-sharing.ts';

test('structurallyEqual compares JSON-like values deeply', () => {
  assert.equal(structurallyEqual({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 }), true);
  assert.equal(structurallyEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(structurallyEqual([1, 2], [1, 2, 3]), false);
  assert.equal(structurallyEqual({ a: null }, { a: null }), true);
  assert.equal(structurallyEqual({ a: null }, { a: undefined }), false);
  // 缺字段与显式 undefined 视为相同:JSON 里本来就不存在 undefined。
  assert.equal(structurallyEqual({ a: 1, b: undefined }, { a: 1 }), true);
  assert.equal(structurallyEqual({ a: [] }, { a: {} }), false);
});

test('unchanged items keep their previous object, changed ones are replaced', () => {
  const previous = [
    { id: 'a', unread: 0, last: { text: 'hi' } },
    { id: 'b', unread: 1, last: { text: 'yo' } },
  ];
  const next = [
    { id: 'a', unread: 0, last: { text: 'hi' } },
    { id: 'b', unread: 2, last: { text: 'yo' } },
  ];
  const shared = reuseUnchanged(previous, next);
  assert.equal(shared[0], previous[0]);
  assert.equal(shared[1], next[1]);
  assert.notEqual(shared, previous);
});

test('a reload that changed nothing returns the very same array', () => {
  // 回到消息页的重拉多半什么都没变:数组引用不变,订阅方一个都不用重渲染。
  const previous = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
  const next = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
  assert.equal(reuseUnchanged(previous, next), previous);
});

test('a reorder with equal items still yields a new array with the old objects', () => {
  const previous = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
  const next = [{ id: 'b', n: 2 }, { id: 'a', n: 1 }];
  const shared = reuseUnchanged(previous, next);
  assert.notEqual(shared, previous);
  assert.equal(shared[0], previous[1]);
  assert.equal(shared[1], previous[0]);
});

test('new and removed items are handled', () => {
  const previous = [{ id: 'a', n: 1 }, { id: 'gone', n: 0 }];
  const next = [{ id: 'a', n: 1 }, { id: 'new', n: 3 }];
  const shared = reuseUnchanged(previous, next);
  assert.equal(shared.length, 2);
  assert.equal(shared[0], previous[0]);
  assert.equal(shared[1], next[1]);
});
