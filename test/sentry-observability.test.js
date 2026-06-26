const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Loads a TS module under test, stubbing native deps so it runs in plain node.
function load(rel, stubs = {}) {
  const filePath = path.join(process.cwd(), rel);
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (s) => {
      if (s in stubs) return stubs[s];
      if (s.startsWith("@/")) return {};
      return require(s);
    },
    process: { env: {} },
    __DEV__: false,
    console,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function loadSentry(extra = {}) {
  return load("src/observability/sentry.ts", {
    "@sentry/react-native": { init() {}, wrap: (c) => c },
    "expo-constants": { expoConfig: { extra } },
  });
}

test("resolveSentryDsn prefers EXPO_PUBLIC_SENTRY_DSN over extra", () => {
  const { resolveSentryDsn } = loadSentry();
  const dsn = resolveSentryDsn({
    env: { EXPO_PUBLIC_SENTRY_DSN: "https://a@o/1" },
    extra: { sentryDsn: "https://b@o/2" },
  });
  assert.equal(dsn, "https://a@o/1");
});

test("resolveSentryDsn falls back to extra.sentryDsn", () => {
  const { resolveSentryDsn } = loadSentry();
  const dsn = resolveSentryDsn({ env: {}, extra: { sentryDsn: "https://b@o/2" } });
  assert.equal(dsn, "https://b@o/2");
});

test("resolveSentryDsn returns undefined when blank or unset", () => {
  const { resolveSentryDsn } = loadSentry();
  assert.equal(
    resolveSentryDsn({ env: { EXPO_PUBLIC_SENTRY_DSN: "   " }, extra: { sentryDsn: "" } }),
    undefined,
  );
  assert.equal(resolveSentryDsn({ env: {}, extra: {} }), undefined);
});

test("initSentry is a no-op without a dsn", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  const client = { init: (o) => calls.push(o), wrap: (c) => c };
  const enabled = initSentry({ client });
  assert.equal(enabled, false);
  assert.equal(calls.length, 0);
});

test("initSentry initializes with the resolved dsn and safe defaults", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  const client = { init: (o) => calls.push(o), wrap: (c) => c };
  const enabled = initSentry({
    client,
    dsn: "https://a@o/1",
    environment: "production",
  });
  assert.equal(enabled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dsn, "https://a@o/1");
  assert.equal(calls[0].environment, "production");
  assert.equal(calls[0].sendDefaultPii, false);
});

test("wrapWithSentry wraps only when enabled", () => {
  const { wrapWithSentry } = loadSentry();
  const wrapped = { wrapped: true };
  const client = { init() {}, wrap: () => wrapped };
  const Comp = () => null;
  assert.equal(wrapWithSentry(Comp, { client, enabled: true }), wrapped);
  assert.equal(wrapWithSentry(Comp, { client, enabled: false }), Comp);
});

test("root layout initializes and wraps with Sentry", () => {
  const layout = fs.readFileSync(
    path.join(process.cwd(), "app/_layout.tsx"),
    "utf8",
  );
  assert.match(layout, /from ['"]@\/observability\/sentry['"]/);
  assert.match(layout, /\binitSentry\(\)/);
  assert.match(layout, /export default wrapWithSentry\(\s*RootLayout\s*\)/);
});

test("reportError forwards to captureException with extra context", () => {
  const { reportError } = loadSentry();
  const calls = [];
  const client = { captureException: (e, ctx) => calls.push([e, ctx]) };
  const err = new Error("boom");

  reportError(err, { endpoint: "/api/v1/x", status: 500 }, client);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], err);
  // Property-level checks: the captureContext object is built inside the
  // vm-loaded module (a different realm), so deepStrictEqual would fail on the
  // mismatched prototype even though the structure is identical.
  assert.equal(calls[0][1].extra.endpoint, "/api/v1/x");
  assert.equal(calls[0][1].extra.status, 500);
});

test("reportError omits extra when no context is given", () => {
  const { reportError } = loadSentry();
  const calls = [];
  const client = { captureException: (e, ctx) => calls.push([e, ctx]) };

  reportError(new Error("x"), undefined, client);

  assert.equal(calls[0][1], undefined);
});

test("shouldReportHttpFailure reports network(0)/5xx, skips 4xx", () => {
  const { shouldReportHttpFailure } = loadSentry();
  for (const s of [0, 500, 502, 503]) {
    assert.equal(shouldReportHttpFailure(s), true, `status ${s} should report`);
  }
  for (const s of [400, 401, 403, 404, 409, 429]) {
    assert.equal(shouldReportHttpFailure(s), false, `status ${s} should skip`);
  }
  assert.equal(shouldReportHttpFailure(undefined), true);
});
