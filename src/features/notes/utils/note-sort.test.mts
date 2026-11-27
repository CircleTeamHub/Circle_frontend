import test from 'node:test';
import assert from 'node:assert/strict';
import { applySubsetOrder, moveToFront, reorderManual, sortNotes } from './note-sort.ts';

const note = (id: string, createdAt: string, updatedAt: string, pinned = false) => ({
  id,
  pinned,
  createdAt: `2026-11-${createdAt}T00:00:00.000Z`,
  updatedAt: `2026-11-${updatedAt}T00:00:00.000Z`,
});

// a 最早添加、最近编辑；c 最晚添加、最早编辑。
const a = note('a', '01', '20');
const b = note('b', '05', '10');
const c = note('c', '09', '02');
const ids = (notes: { id: string }[]) => notes.map((item) => item.id);

test('recently edited puts the latest edit first', () => {
  assert.deepEqual(ids(sortNotes([c, a, b], 'edited', [])), ['a', 'b', 'c']);
});

test('recently added puts the newest note first', () => {
  assert.deepEqual(ids(sortNotes([a, b, c], 'added', [])), ['c', 'b', 'a']);
});

test('manual order follows the saved order', () => {
  assert.deepEqual(ids(sortNotes([a, b, c], 'manual', ['b', 'a', 'c'])), ['b', 'a', 'c']);
});

test('notes missing from the manual order go on top, newest first', () => {
  const d = note('d', '20', '20');
  assert.deepEqual(ids(sortNotes([a, b, c, d], 'manual', ['a', 'b'])), ['d', 'c', 'a', 'b']);
});

test('pinned notes stay on top in every mode', () => {
  const pinnedC = { ...c, pinned: true };
  assert.deepEqual(ids(sortNotes([a, b, pinnedC], 'edited', [])), ['c', 'a', 'b']);
  assert.deepEqual(ids(sortNotes([a, b, pinnedC], 'added', [])), ['c', 'b', 'a']);
  assert.deepEqual(ids(sortNotes([a, b, pinnedC], 'manual', ['a', 'b', 'c'])), ['c', 'a', 'b']);
});

test('sorting never mutates the input', () => {
  const input = [c, a, b];
  sortNotes(input, 'edited', []);
  assert.deepEqual(ids(input), ['c', 'a', 'b']);
});

test('reordering one group only moves that group within its own slots', () => {
  // 全部：a x b y c；分组里只有 a b c，调成 c a b。
  assert.deepEqual(
    applySubsetOrder(['a', 'x', 'b', 'y', 'c'], ['c', 'a', 'b']),
    ['c', 'x', 'a', 'y', 'b'],
  );
});

test('a note deleted while reordering does not push another note out', () => {
  assert.deepEqual(applySubsetOrder(['a', 'b'], ['gone', 'b', 'a']), ['b', 'a']);
});

test('moveToFront moves one id to the head without dropping others', () => {
  assert.deepEqual(moveToFront(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(moveToFront(['a', 'b', 'c'], 'a'), ['a', 'b', 'c']);
});

test('pinning is not baked into the manual order: an unpinned note returns to its slot', () => {
  const pinnedB = { ...b, pinned: true };
  // 手动顺序 a b c；面板里置顶的 b 显示在最前：b a c。把 c 移到最前。
  const next = reorderManual([a, pinnedB, c], ['a', 'b', 'c'], moveToFront(['b', 'a', 'c'], 'c'));
  assert.deepEqual(next, ['c', 'b', 'a']);
  // 显示时 b 仍因置顶在最前；取消置顶后回到 c 和 a 之间。
  assert.deepEqual(ids(sortNotes([a, pinnedB, c], 'manual', next)), ['b', 'c', 'a']);
  assert.deepEqual(ids(sortNotes([a, b, c], 'manual', next)), ['c', 'b', 'a']);
});

test('reorderManual keeps notes outside the visible group in place', () => {
  const x = note('x', '02', '02');
  // 全部：a x b c；分组里只有 a b c，调成 c a b。
  assert.deepEqual(reorderManual([a, x, b, c], ['a', 'x', 'b', 'c'], ['c', 'a', 'b']), ['c', 'x', 'a', 'b']);
});
