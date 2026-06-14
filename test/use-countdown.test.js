const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 加载并提取 hook 内部的纯逻辑（nextTick）以便无 React 环境下测试。
function loadModule() {
  const filePath = path.join(process.cwd(), "src/hooks/use-countdown.ts");
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === "react") {
        return {
          useState: () => [0, () => {}],
          useEffect: () => {},
          useCallback: (fn) => fn,
          useRef: () => ({ current: null }),
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test("nextTick decrements to zero and stops", () => {
  const { nextTick } = loadModule();
  assert.equal(nextTick(3), 2);
  assert.equal(nextTick(1), 0);
  assert.equal(nextTick(0), 0);
});
