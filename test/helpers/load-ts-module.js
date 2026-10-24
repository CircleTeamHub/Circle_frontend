const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./observability-stubs');

/**
 * Transpile a TS source file and run it in a fresh VM context.
 *
 * node --test cannot resolve the `@/...` path alias, so tests that need a module
 * with aliased imports load it here and shim those imports via `requireShim`.
 * `context` supplies globals the module reads at load time (e.g. __DEV__).
 *
 * 观测层模块（`@/observability/report-failure`、`@/utils/dev-log`）不必逐个测试去
 * 桩：这里默认给无副作用替身，测试自己提供的导出仍然优先（见 observability-stubs）。
 * 其余解析不了的源码 import 回落到真实模块（见 withSourceFallback）。
 */
/** `@/x` 或相对路径对应的源码文件（.ts / .tsx）；找不到返回 null。 */
function resolveSourceFile(specifier, fromFile) {
  let base = null;
  if (specifier.startsWith('@/')) {
    base = path.join(process.cwd(), 'src', specifier.slice(2));
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  }
  if (!base) return null;
  return ['.ts', '.tsx'].map((ext) => base + ext).find((file) => fs.existsSync(file)) ?? null;
}

/**
 * 测试的 requireShim 没有覆盖、Node 也解析不了的源码 import（`@/...` 或相对路径），
 * 回落到真实模块（同一套 requireShim / context 递归装载）。被装模块新增一个纯函数
 * 依赖时，不必挨个给几十个手写桩补 case；测试自己提供的替身仍然优先。
 */
function withSourceFallback(requireImpl, fromFile, options) {
  return (request) => {
    try {
      return requireImpl(request);
    } catch (error) {
      if (!error || error.code !== 'MODULE_NOT_FOUND') throw error;
      const source = resolveSourceFile(request, fromFile);
      if (!source) throw error;
      return loadTsModule(path.relative(process.cwd(), source), options);
    }
  };
}

function loadTsModule(relativePath, { requireShim, context: extraContext } = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: withSourceFallback(
      withObservabilityStubs(requireShim ?? require),
      filePath,
      { requireShim, context: extraContext },
    ),
    ...extraContext,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

module.exports = { loadTsModule };
