const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function runModule(rel, requireFn = () => ({})) {
  const filePath = path.join(process.cwd(), rel);
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    Promise,
    setTimeout,
    clearTimeout,
    console,
    module: { exports: {} },
    exports: {},
    require: requireFn,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

// setter 一直有 Number.isFinite 校验，但**水合**只查了 typeof === 'number'。
// NaN / Infinity / 负数全都是 number，于是持久化里的任何一个坏值都会活过重启。
// NaN 尤其安静：`pinnedFoldCount === 0` 是假、`visiblePinned <= NaN` 也是假，
// 置顶折叠既不展开也不收起，用户只看到列表不对，没有任何报错。
test('置顶折叠阈值的水合与写入用同一道校验', () => {
  const source = read('src/features/profile/store/use-app-settings-store.ts');

  assert.match(source, /function normalizePinnedFoldCount\(value: unknown\)/);
  // 写入与水合两条路径都必须走它。
  assert.match(source, /setPinnedFoldCount: \(value\) =>\s*set\(\{ pinnedFoldCount: normalizePinnedFoldCount\(value\) \}\)/);
  assert.match(source, /pinnedFoldCount: normalizePinnedFoldCount\(\s*persistedState\.pinnedFoldCount,\s*\)/);
  // 水合里不能再有那条只看类型的判断。
  assert.doesNotMatch(
    source,
    /typeof persistedState\.pinnedFoldCount === 'number'\s*\?\s*persistedState\.pinnedFoldCount/,
  );
});

// 这一屏只提供「选图」，而 store 里清除背景的唯一入口是传一个 mode: 'global'
// 的偏好 —— 界面上没有任何地方会那么做。设过一次之后就再也退不回默认。
test('聊天背景设过之后可以恢复默认', () => {
  const source = read('src/features/chat/screens/ChatBackgroundScreen.tsx');

  assert.match(source, /const handleRestoreDefault = useCallback/);
  assert.match(source, /setGlobalBackgroundPreference\(\{ mode: 'global' \}\)/);
  assert.match(
    source,
    /setChatBackgroundPreference\(conversationID, \{ mode: 'global' \}\)/,
  );
  // 只在真的设过背景时才出现这一行。
  assert.match(source, /hasBackground \? \(/);
  assert.match(source, /chat\.background\.restoreDefault/);
});

test('恢复默认的文案五语齐全', () => {
  for (const lng of ['zh', 'en', 'ja', 'ko', 'es']) {
    const bundle = JSON.parse(read(`src/i18n/locales/${lng}.json`));
    const text = bundle.chat?.background?.restoreDefault;
    assert.equal(typeof text, 'string', `${lng} 缺 chat.background.restoreDefault`);
    assert.ok(text.trim().length > 0, `${lng} 的文案是空的`);
  }
});

// 缩略图是串行排队生成的。只要有一个视频让原生调用挂住不返回，它后面每一个
// 缩略图都永远排在它后面 —— 一个坏文件就让整列预览停在占位方块上。
test('挂住的缩略图任务超时后放行队列', async () => {
  const { withThumbnailTimeout } = runModule(
    'src/features/notes/utils/thumbnail-timeout.ts',
  );
  const never = new Promise(() => {});

  const result = await withThumbnailTimeout(never, () => {}, 10);

  assert.equal(result, null);
});

test('正常返回的缩略图原样交出去，不受超时影响', async () => {
  const { withThumbnailTimeout } = runModule(
    'src/features/notes/utils/thumbnail-timeout.ts',
  );

  const result = await withThumbnailTimeout(Promise.resolve('thumb'), () => {}, 1_000);

  assert.equal(result, 'thumb');
});

// 迟到的那张是原生位图，没人持有就是一次泄漏。
test('超时之后迟到的结果仍然被释放', async () => {
  const { withThumbnailTimeout } = runModule(
    'src/features/notes/utils/thumbnail-timeout.ts',
  );
  let released = null;
  let resolveLate;
  const late = new Promise((resolve) => {
    resolveLate = resolve;
  });

  const result = await withThumbnailTimeout(
    late,
    (value) => {
      released = value;
    },
    10,
  );
  assert.equal(result, null);

  resolveLate('late-thumb');
  await late;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(released, 'late-thumb');
});

test('释放迟到结果时抛错不会冒出去', async () => {
  const { withThumbnailTimeout } = runModule(
    'src/features/notes/utils/thumbnail-timeout.ts',
  );
  let resolveLate;
  const late = new Promise((resolve) => {
    resolveLate = resolve;
  });

  await withThumbnailTimeout(
    late,
    () => {
      throw new Error('player already released');
    },
    10,
  );

  resolveLate('late-thumb');
  await late;
  await new Promise((resolve) => setTimeout(resolve, 0));
  // 走到这里就说明那次抛错没有变成未捕获的 rejection。
  assert.ok(true);
});

test('缩略图队列真的用上了这道超时', () => {
  const source = read('src/features/notes/components/VideoDraftPreview.native.tsx');

  assert.match(source, /withThumbnailTimeout\(pending, \(late\) => late\.release\(\)\)/);
});
