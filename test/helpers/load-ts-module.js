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
 */
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
    require: withObservabilityStubs(requireShim ?? require),
    ...extraContext,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

module.exports = { loadTsModule };
