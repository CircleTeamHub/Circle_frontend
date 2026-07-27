const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// contact-friends.ts 只有 type-only import,transpile 后无运行时依赖,可直接加载。
const { buildContactSections, dedupeFriendsById } = loadTsModule(
  'src/features/contacts/contact-friends.ts',
);

const f = (id, nickname, accountId = id) => ({ id, nickname, accountId });

test('dedupeFriendsById 按 id 去重并保留首次出现', () => {
  const out = dedupeFriendsById([f('a', 'Alice'), f('a', 'Alice-dup'), f('b', 'Bob')]);
  assert.deepEqual(
    out.map((x) => x.id),
    ['a', 'b'],
  );
  assert.equal(out[0].nickname, 'Alice'); // 保留首次出现的那条
});

test('buildContactSections 不产生重复 id 的行(SectionList key 全局唯一)', () => {
  // 复现:后端 /friend 把同一好友返回两次 → 之前两个 <SectionList> 子节点同 key 报错。
  const dupId = '2d7012c03-1a39-b4d9-1708-565f11edfbd0';
  const sections = buildContactSections([f(dupId, 'Zoe'), f(dupId, 'Zoe'), f('b1', 'Bob')]);

  const ids = sections.flatMap((section) => section.data.map((row) => row.id));
  assert.equal(new Set(ids).size, ids.length, `出现重复 id: ${ids.join(', ')}`);
  assert.equal(ids.filter((id) => id === dupId).length, 1, '重复好友应只保留一条');
});
