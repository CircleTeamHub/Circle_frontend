/**
 * 圈子是纯邀请制 —— 用户不能自己搜到、也不能浏览自己没加入的圈子。
 *
 * 「发现圈子」那条链路（屏 + 路由 + 全站圈子列表 + 列表接口 + 文案 + locator）
 * 整片移除。这个文件守它不悄悄长回来：任何一处漏网，用户就又能枚举全站圈子。
 *
 * 注意边界：这里管的是「自助发现」。邀请、二维码、担保入圈那几条路径不受影响，
 * 它们本来就是邀请制的实现方式。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(process.cwd(), rel));

test('自助发现圈子的屏和路由都不存在', () => {
  assert.equal(
    exists('src/features/discover/screens/DiscoverCirclesScreen.tsx'),
    false,
  );
  assert.equal(exists('app/(tabs)/discover/circles.tsx'), false);
});

test('circles store 不再持有全站圈子列表', () => {
  const store = read('src/features/discover/store/use-circles-store.ts');

  // allCircles 是「平台上所有圈子」，纯邀请制下客户端压根不该拿到这份数据。
  assert.doesNotMatch(store, /allCircles/);
  assert.doesNotMatch(store, /fetchAllCircles/);
  assert.doesNotMatch(store, /ALL_CIRCLES_LIMIT/);
  assert.doesNotMatch(store, /circle_discover_list_capped/);

  // 「我的圈子」这一半必须原样留着 —— 邀请进来之后要靠它。
  assert.match(store, /fetchMyCircles/);
  assert.match(store, /joinedCircles/);
});

test('前端不再有列出全站圈子的接口', () => {
  const api = read('src/services/api/circles.ts');

  assert.doesNotMatch(api, /export async function fetchCircles\(/);
  assert.match(api, /export async function fetchMyCircles\(/);
});

test('搜圈子的 locator 和文案都已清干净', () => {
  const catalog = read('src/testing/e2e-test-ids.ts');
  const contract = read('e2e/locator-contract.json');

  for (const key of ['circleSearchScreen', 'circleSearchInput', 'circleSearchResult']) {
    assert.doesNotMatch(catalog, new RegExp(key));
    assert.doesNotMatch(contract, new RegExp(key));
  }

  // 五语文案一起清，别留下没人引用的死 key。
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    for (const key of [
      'discoverCircles',
      'searchCirclePlaceholder',
      'noCirclesFound',
      'searchCappedNotice',
      'memberCount',
      'needsApproval',
    ]) {
      assert.equal(dict.discover[key], undefined, `${locale} discover.${key}`);
    }
  }
});
