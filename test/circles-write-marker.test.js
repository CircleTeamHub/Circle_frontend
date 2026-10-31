const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// 发现页/圈子详情回到前台时据此判断能不能跳过重拉:圈子相关的写请求成功后都要记一笔,
// 读请求不算。宁可多拉,不显示旧数据。
function loadCirclesApi() {
  return loadTsModule('src/services/api/circles.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/client') return { apiClient: async () => ({}) };
      if (request === '@/services/api/utils') {
        return { allowPeerMediaUrl: (value) => value, buildQuery: () => '' };
      }
      if (request === './collect-cursor-pages') {
        return { collectCursorPages: async () => [] };
      }
      return require(request);
    },
  });
}

test('circle writes mark circles stale; reads do not', async () => {
  const circles = loadCirclesApi();
  const before = Date.now();
  await circles.fetchCircleDetail('c1').catch(() => {});
  assert.equal(circles.circlesMutatedSince(before), false);

  await circles.joinCircle('c1');
  assert.equal(circles.circlesMutatedSince(before), true);
});

test('every circle write goes through the marker with a static apiClient path', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/circles.ts'),
    'utf8',
  );
  const writes = source.match(/method: '(POST|PATCH|PUT|DELETE)'/g) ?? [];
  const marked = source.match(/markCircleWrite\(\s*apiClient/g) ?? [];
  assert.ok(writes.length > 0);
  assert.equal(marked.length, writes.length, 'wrap every circle write in markCircleWrite');
});
