const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(apiResponse) {
  const filePath = path.join(process.cwd(), "src/services/api/plaza.ts");
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { "@/*": ["src/*"] },
    },
    fileName: filePath,
  }).outputText;
  const calls = [];
  const context = {
    module: { exports: {} },
    exports: {},
    require: (s) => {
      if (s === "@/services/api/client")
        return {
          apiClient: async (...a) => {
            calls.push(a);
            return apiResponse;
          },
        };
      if (s === "@/services/api/utils")
        return { buildQuery: () => "", normalizeMediaUrl: (u) => u };
      if (s.startsWith("@/")) return {};
      return require(s);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { api: context.module.exports, calls };
}

test("signupForPost POSTs /circle-plaza/posts/:id/signup", async () => {
  const { api, calls } = load({ signed: true, signupCount: 1 });
  const r = await api.signupForPost("p1");
  assert.equal(calls[0][0], "/circle-plaza/posts/p1/signup");
  assert.equal(calls[0][1].method, "POST");
  assert.deepEqual(r, { signed: true, signupCount: 1 });
});

test("cancelSignup DELETEs /circle-plaza/posts/:id/signup", async () => {
  const { api, calls } = load({ signed: false, signupCount: 0 });
  await api.cancelSignup("p1");
  assert.equal(calls[0][0], "/circle-plaza/posts/p1/signup");
  assert.equal(calls[0][1].method, "DELETE");
});
