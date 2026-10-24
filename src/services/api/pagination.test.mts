import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCursorPages, collectOffsetPages, readHasMore } from './pagination.ts';

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

test('offset pages are fetched until the server says there is no more', async () => {
  const requested: number[] = [];
  const pages = new Map([
    [1, { rows: rows('a', 'b'), hasMore: true }],
    [2, { rows: rows('c', 'd'), hasMore: true }],
    [3, { rows: rows('e'), hasMore: false }],
  ]);
  const all = await collectOffsetPages(
    async (page) => {
      requested.push(page);
      return pages.get(page)!;
    },
    { pageSize: 2, maxPages: 10 },
  );
  assert.deepEqual(requested, [1, 2, 3]);
  assert.deepEqual(all.map((row) => row.id), ['a', 'b', 'c', 'd', 'e']);
});

test('without a has-more header, a full page means "maybe more"', async () => {
  // 网页端读不到未暴露的响应头时退回按条数判断:满页才继续。
  const requested: number[] = [];
  const all = await collectOffsetPages(
    async (page) => {
      requested.push(page);
      return page === 1
        ? { rows: rows('a', 'b'), hasMore: null }
        : { rows: rows('c'), hasMore: null };
    },
    { pageSize: 2, maxPages: 10 },
  );
  assert.deepEqual(requested, [1, 2]);
  assert.deepEqual(all.map((row) => row.id), ['a', 'b', 'c']);
});

test('rows shifted across pages by a concurrent edit are not duplicated', async () => {
  const all = await collectOffsetPages(
    async (page) =>
      page === 1
        ? { rows: rows('a', 'b'), hasMore: true }
        : { rows: rows('b', 'c'), hasMore: false },
    { pageSize: 2, maxPages: 10 },
  );
  assert.deepEqual(all.map((row) => row.id), ['a', 'b', 'c']);
});

test('offset paging stops at maxPages', async () => {
  let calls = 0;
  await collectOffsetPages(
    async (page) => {
      calls += 1;
      return { rows: rows(`p${page}`), hasMore: true };
    },
    { pageSize: 1, maxPages: 3 },
  );
  assert.equal(calls, 3);
});

test('cursor pages follow the next cursor from the empty start', async () => {
  const cursors: string[] = [];
  const all = await collectCursorPages(
    async (cursor) => {
      cursors.push(cursor);
      if (cursor === '') return { rows: rows('a', 'b'), nextCursor: 'b' };
      if (cursor === 'b') return { rows: rows('c'), nextCursor: null };
      throw new Error(`unexpected cursor ${cursor}`);
    },
    { maxPages: 10 },
  );
  assert.deepEqual(cursors, ['', 'b']);
  assert.deepEqual(all.map((row) => row.id), ['a', 'b', 'c']);
});

test('a cursor that does not advance stops the walk instead of looping', async () => {
  let calls = 0;
  const all = await collectCursorPages(
    async () => {
      calls += 1;
      return { rows: rows('a'), nextCursor: 'a' };
    },
    { maxPages: 10 },
  );
  assert.equal(calls, 2);
  assert.deepEqual(all.map((row) => row.id), ['a']);
});

test('readHasMore parses the header and reports absence as unknown', () => {
  const headers = (value: string | null) => ({ get: () => value });
  assert.equal(readHasMore(headers('true')), true);
  assert.equal(readHasMore(headers('false')), false);
  assert.equal(readHasMore(headers(null)), null);
  assert.equal(readHasMore(headers('maybe')), null);
});

test('a server that ignores the page parameter does not spin until maxPages', async () => {
  // 每页都原样返回第一页、还说「后面还有」:一页一个新 id 都没有就该停。
  let calls = 0;
  const all = await collectOffsetPages(
    async () => {
      calls += 1;
      return { rows: rows('a', 'b'), hasMore: true };
    },
    { pageSize: 2, maxPages: 20 },
  );
  assert.equal(calls, 2);
  assert.deepEqual(all.map((row) => row.id), ['a', 'b']);
});
