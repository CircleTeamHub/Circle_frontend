const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 加载 src/utils/email.ts —— 纯函数，无依赖，直接 transpile + 运行。
function loadEmailUtil() {
  const filePath = path.join(process.cwd(), "src/utils/email.ts");
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, exports: {} };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test("isValidEmail accepts well-formed addresses", () => {
  const { isValidEmail } = loadEmailUtil();
  assert.equal(isValidEmail("a@b.com"), true);
  assert.equal(isValidEmail("user.name+tag@example.co.uk"), true);
  // 内部 trim：前后空格不影响判定（与提交前归一化一致）。
  assert.equal(isValidEmail("  a@b.com  "), true);
});

test("isValidEmail rejects malformed addresses", () => {
  const { isValidEmail } = loadEmailUtil();
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("plainaddress"), false);
  assert.equal(isValidEmail("@no-local.com"), false);
  assert.equal(isValidEmail("no-at-sign.com"), false);
  assert.equal(isValidEmail("no-domain@"), false);
  assert.equal(isValidEmail("two@@at.com"), false);
  assert.equal(isValidEmail("space in@email.com"), false);
});

test("normalizeEmail trims and lowercases", () => {
  const { normalizeEmail } = loadEmailUtil();
  assert.equal(normalizeEmail("  A@B.COM "), "a@b.com");
  assert.equal(normalizeEmail("User@Example.Com"), "user@example.com");
});
