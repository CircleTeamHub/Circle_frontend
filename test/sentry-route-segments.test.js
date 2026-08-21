const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 白名单方案只有在「清单与真实路由一致」时才成立。这条测试是那个前提的守卫：
// 新增路由却忘了重新生成清单，这里必红。
//
// 漂移的后果是不对称的，所以两个方向的严重性不同：
//   - 清单少了段  → 那个屏幕的 transaction 退化成 :id。只丢分组粒度，不泄漏。
//   - 清单多了段  → 一个不再是路由的名字被当作安全值保留。如果它恰好与某个
//                   用户可控的 id 相同，就是泄漏。所以多余项也必须报错。
const APP_DIR = path.join(process.cwd(), "app");
const SEGMENTS_FILE = "src/observability/route-segments.ts";

function walk(dir) {
  return fs.readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return fs.statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** 从 app/ 的路由文件派生 URL 段集合（与 scripts/gen-route-segments.mjs 同逻辑）。 */
function segmentsFromRoutes() {
  const segments = new Set();
  for (const file of walk(APP_DIR)) {
    if (!/\.(tsx|ts|jsx|js)$/.test(file)) continue;
    const rel = path.relative(APP_DIR, file).replace(/\.(tsx|ts|jsx|js)$/, "");
    for (const segment of rel.split(path.sep)) {
      // _layout 不是 URL 段；index 代表父路径本身；[param] 由 sanitize 单独处理。
      if (segment === "_layout" || segment === "index") continue;
      // + 前缀是 expo-router 特殊文件(+html/+not-found),不是 URL 段。
      if (segment.startsWith("[") || segment.startsWith("+")) continue;
      segments.add(segment);
    }
  }
  return segments;
}

function loadAllowlist() {
  const filePath = path.join(process.cwd(), SEGMENTS_FILE);
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, exports: {}, require };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports.STATIC_ROUTE_SEGMENTS;
}

test("the static-segment allowlist matches the real Expo Router tree", () => {
  const actual = segmentsFromRoutes();
  const allowlist = loadAllowlist();

  const missing = [...actual].filter((s) => !allowlist.has(s)).sort();
  const stale = [...allowlist].filter((s) => !actual.has(s)).sort();

  assert.deepEqual(
    missing,
    [],
    `app/ 里有路由段不在白名单中，这些屏幕的 transaction 会退化成 :id。\n` +
      `重新生成：node scripts/gen-route-segments.mjs\n缺少: ${missing.join(", ")}`,
  );
  assert.deepEqual(
    stale,
    [],
    `白名单里有段已不是路由。它会被当作安全值原样发给 Sentry —— 若与某个\n` +
      `用户可控的 id 相同即构成泄漏。\n重新生成：node scripts/gen-route-segments.mjs\n` +
      `多余: ${stale.join(", ")}`,
  );
});

test("the allowlist is non-trivial and contains no id-shaped entries", () => {
  const allowlist = loadAllowlist();

  // 空集合会让每个 transaction 都变成 :id —— 测试全过但功能没了。
  assert.ok(allowlist.size > 50, `白名单只有 ${allowlist.size} 项，疑似生成失败`);

  // 生成脚本要是把 [id] 之类的动态段漏进来，白名单就等于放行了那一位。
  for (const segment of allowlist) {
    assert.ok(
      !segment.startsWith("["),
      `动态段不该进白名单: ${segment}`,
    );
    assert.match(
      segment,
      /^[a-z0-9()_.+-]+$/,
      `路由段形状异常，可能不是静态段: ${segment}`,
    );
  }
});
