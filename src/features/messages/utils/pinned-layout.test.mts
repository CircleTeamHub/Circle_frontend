import test from 'node:test';
import assert from 'node:assert/strict';
import { dividerlessRowsKeyOf, parseDividerlessRowsKey } from './pinned-layout.ts';

const row = (id: string, pinned = false) => ({ id, pinned });
const dividerless = (rows: ReturnType<typeof row>[]) => [...parseDividerlessRowsKey(dividerlessRowsKeyOf(rows))];

test('the first row and the first row after the pinned block have no divider', () => {
  // 置顶之间、普通会话之间照常画线;置顶灰切回列表底色本身就是分界。
  assert.deepEqual(
    dividerless([row('a', true), row('b', true), row('c', true), row('x'), row('y')]),
    ['a', 'x'],
  );
});

test('every pinned / unpinned change of colour is a boundary without a divider', () => {
  assert.deepEqual(dividerless([row('x'), row('a', true), row('y')]), ['x', 'a', 'y']);
  assert.deepEqual(dividerless([row('x'), row('y')]), ['x']);
});

test('the key ignores reordering inside the unpinned section, so a new message does not invalidate it', () => {
  // 新消息只把非置顶会话挪到非置顶区里;只要交界处还是同一条,键不变,
  // renderItem 就保持同一个引用,没变的行不重渲染。
  const before = dividerlessRowsKeyOf([row('a', true), row('b', true), row('x'), row('y'), row('z')]);
  const afterMessage = dividerlessRowsKeyOf([row('a', true), row('b', true), row('x'), row('z'), row('y')]);
  assert.equal(afterMessage, before);

  const afterUnpin = dividerlessRowsKeyOf([row('a', true), row('b'), row('x'), row('y')]);
  assert.notEqual(afterUnpin, before);
});

test('an empty list has no dividerless rows', () => {
  assert.equal(parseDividerlessRowsKey(dividerlessRowsKeyOf([])).size, 0);
});
