import assert from 'node:assert/strict';
import test from 'node:test';

import { getContactListItemLayout } from './contact-list-layout.ts';

// SectionList 把每个分组摊平成 [分组标题, ...好友行, 分组尾]:这里三组分别 2/1/3 人。
const sections = [
  { data: ['a1', 'a2'] },
  { data: ['b1'] },
  { data: ['c1', 'c2', 'c3'] },
];
const metrics = { listHeaderHeight: 300, sectionHeaderHeight: 32, rowHeight: 68 };

test('the first section header starts right below the list header', () => {
  assert.deepEqual(getContactListItemLayout(sections, 0, metrics), {
    index: 0,
    offset: 300,
    length: 32,
  });
});

test('rows follow their section header back to back', () => {
  assert.deepEqual(getContactListItemLayout(sections, 1, metrics), { index: 1, offset: 332, length: 68 });
  assert.deepEqual(getContactListItemLayout(sections, 2, metrics), { index: 2, offset: 400, length: 68 });
});

test('the section footer takes no space, so the next header starts where the last row ends', () => {
  assert.deepEqual(getContactListItemLayout(sections, 3, metrics), { index: 3, offset: 468, length: 0 });
  assert.deepEqual(getContactListItemLayout(sections, 4, metrics), { index: 4, offset: 468, length: 32 });
});

test('a far section header accounts for every earlier header and row', () => {
  // 第三组标题的扁平下标:(1+2+1) + (1+1+1) = 7。
  assert.deepEqual(getContactListItemLayout(sections, 7, metrics), {
    index: 7,
    offset: 300 + (32 + 2 * 68) + (32 + 68),
    length: 32,
  });
  // 最后一个好友行。
  assert.deepEqual(getContactListItemLayout(sections, 10, metrics), {
    index: 10,
    offset: 300 + (32 + 2 * 68) + (32 + 68) + 32 + 2 * 68,
    length: 68,
  });
});
