const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// 纯函数、无依赖：transpile 后直接跑，做真正的行为断言。
function loadExpiryUtil() {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/utils/plaza-post-expiry.ts'),
    'utf8',
  );
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', js)(module, module.exports);
  return module.exports;
}

const { getPostExpiryTier } = loadExpiryUtil();

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-07-10T12:00:00Z').getTime();
const expiresIn = (hours) => new Date(NOW + hours * HOUR).toISOString();

test('getPostExpiryTier: >3天剩余 → ample (充裕/紫)', () => {
  assert.equal(getPostExpiryTier(expiresIn(168), NOW), 'ample'); // 7天
  assert.equal(getPostExpiryTier(expiresIn(96), NOW), 'ample'); // 4天
  assert.equal(getPostExpiryTier(expiresIn(73), NOW), 'ample'); // 刚过3天
});

test('getPostExpiryTier: ≤3天且>1天剩余 → soon (临近/橙)', () => {
  assert.equal(getPostExpiryTier(expiresIn(72), NOW), 'soon'); // 3天整
  assert.equal(getPostExpiryTier(expiresIn(48), NOW), 'soon'); // 2天
  assert.equal(getPostExpiryTier(expiresIn(25), NOW), 'soon'); // 刚过1天
});

test('getPostExpiryTier: ≤1天剩余或已过期 → urgent (紧急/红)', () => {
  assert.equal(getPostExpiryTier(expiresIn(24), NOW), 'urgent'); // 1天整
  assert.equal(getPostExpiryTier(expiresIn(2), NOW), 'urgent'); // 2小时
  assert.equal(getPostExpiryTier(expiresIn(-1), NOW), 'urgent'); // 已过期
});

test('getPostExpiryTier: 同一帖子随时间从 ample→soon→urgent 逐级跳变', () => {
  const expiresAt = expiresIn(168); // 发帖时 7天后到期
  // 发帖当下（剩 7天）→ 充裕
  assert.equal(getPostExpiryTier(expiresAt, NOW), 'ample');
  // 5天后（剩 2天）→ 临近
  assert.equal(getPostExpiryTier(expiresAt, NOW + 120 * HOUR), 'soon');
  // 6.5天后（剩 12小时）→ 紧急
  assert.equal(getPostExpiryTier(expiresAt, NOW + 156 * HOUR), 'urgent');
});

test('getPostExpiryTier: 到期时间非法 → 回落 ample', () => {
  assert.equal(getPostExpiryTier('not-a-date', NOW), 'ample');
  assert.equal(getPostExpiryTier('', NOW), 'ample');
});
