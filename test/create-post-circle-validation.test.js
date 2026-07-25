const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 发帖圈子校验的唯一防线在「提交」路径：以后端权威成员列表为准，扔掉客户端 UUID
// 格式假设。这些断言锁住重构后的契约，防止回退到脆弱的 regex 判据或分散的边界处理。

test('CreatePostScreen reconciles selected circles against a freshly refreshed membership list before posting', () => {
  const src = read('src/features/social/screens/CreatePostScreen.tsx');

  // 提交前强制刷新权威成员列表再校验（覆盖「离开圈子后不经选择页、直接发帖」）。
  assert.match(src, /await fetchMyCircles\(\{\s*force:\s*true\s*\}\)/);
  assert.match(src, /useCirclesStore\.getState\(\)/);
  assert.match(src, /selectablePostFormCircles\(/);
  assert.match(src, /findUnavailablePostFormCircles\(/);

  // 有失效圈子 → 剔除 + 提示 + 不发帖。
  assert.match(src, /setSelectedCircles\(/);
  assert.match(src, /plaza\.create\.invalidCircle/);

  // 不再用客户端 UUID 格式判有效性。
  assert.doesNotMatch(src, /arePostFormCircleIdsValid/);
});

test('post-form circle selection util no longer relies on client-side UUID format checks', () => {
  const util = read('src/features/discover/utils/post-form-circle-selection.ts');

  assert.doesNotMatch(util, /UUID_PATTERN/);
  assert.doesNotMatch(util, /isValidPostFormCircleId/);
  assert.doesNotMatch(util, /arePostFormCircleIdsValid/);

  // filterAvailable 直接用 available 建索引（信任后端 id），不做格式过滤。
  assert.match(util, /new Map\(\s*[\s\S]*available\.map/);
  assert.match(util, /export function findUnavailablePostFormCircles/);
  assert.match(util, /export function selectablePostFormCircles/);
});

test('SelectCircleScreen no longer mutates the committed selection outside confirm', () => {
  const src = read('src/features/discover/screens/SelectCircleScreen.tsx');

  // 不再有 focus/加载后的 committed 调和（含其完成标志）。
  assert.doesNotMatch(src, /myCirclesFetched/);
  // 唯一写 committed 的地方是 handleConfirm。
  assert.equal(
    (src.match(/setSelectedCircles\(/g) || []).length,
    1,
    'exactly one setSelectedCircles call (handleConfirm)',
  );
});
