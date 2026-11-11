import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePinnedLayoutKey, pinnedLayoutKeyOf } from './pinned-layout.ts';

const row = (id: string, pinned = false) => ({ id, pinned });

test('positions pinned runs as single / first / middle / last', () => {
  const layout = parsePinnedLayoutKey(
    pinnedLayoutKeyOf([
      row('a', true),
      row('b', true),
      row('c', true),
      row('x'),
      row('d', true),
      row('y'),
    ]),
  );
  assert.equal(layout.positions.get('a'), 'first');
  assert.equal(layout.positions.get('b'), 'middle');
  assert.equal(layout.positions.get('c'), 'last');
  assert.equal(layout.positions.get('d'), 'single');
  assert.equal(layout.positions.get('x'), undefined);
});

test('a pinned run ends without a divider; dividers inside it sit on the pinned colour', () => {
  const layout = parsePinnedLayoutKey(
    pinnedLayoutKeyOf([row('a', true), row('b', true), row('x'), row('d', true), row('y')]),
  );
  // 置顶灰切回列表底色本身就是分界,再画一条线就多余了。
  assert.deepEqual([...layout.hiddenSeparatorIds].sort(), ['b', 'd']);
  assert.deepEqual([...layout.pinnedSeparatorIds].sort(), ['a']);
});

test('the key ignores unpinned rows, so a new message does not invalidate it', () => {
  // 新消息只会让非置顶会话改预览、挪到非置顶区顶部;置顶分组的形状不变。
  // 键不变 → renderItem 和分隔线保持同一个引用 → 没变的行不重渲染。
  const before = pinnedLayoutKeyOf([
    row('a', true),
    row('b', true),
    row('x'),
    row('y'),
  ]);
  const afterMessage = pinnedLayoutKeyOf([
    row('a', true),
    row('b', true),
    row('y'),
    row('x'),
  ]);
  assert.equal(afterMessage, before);

  const afterUnpin = pinnedLayoutKeyOf([row('a', true), row('b'), row('x'), row('y')]);
  assert.notEqual(afterUnpin, before);
});

test('an empty list has an empty layout', () => {
  const layout = parsePinnedLayoutKey(pinnedLayoutKeyOf([]));
  assert.equal(layout.positions.size, 0);
  assert.equal(layout.hiddenSeparatorIds.size, 0);
  assert.equal(layout.pinnedSeparatorIds.size, 0);
});
