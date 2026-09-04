const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 「已处理失败」的可观测性契约（源码级）。
//
// 背景：业务 catch 块里的 `if (__DEV__) console.warn(...)` 在 release 包里被 babel
// 剥掉之后，失败在生产上完全无声。现在这类站点必须走 observability/report-failure
// 的 reportHandledFailure（dev 打印 + 面包屑 + 去重后进 Sentry），纯本地信息性输出
// 走 utils/dev-log 的 devWarn。这个文件把「不许再出现裸 console 调用」钉住，
// 否则下一个新屏幕又会悄悄把失败吞回去。

const ROOTS = ['src', 'app'];

// 允许直接调用 console 的文件：观测层自身、dev 专用输出口、没有 __DEV__ 的
// WebView 端、被 VM 测试当作降级信号观测的本地库、以及 vendored 第三方源码。
const CONSOLE_ALLOWLIST = new Set([
  'src/utils/dev-log.ts',
  'src/utils/client-diagnostics.ts',
  'src/observability/report-failure.ts',
  'src/features/notifications/utils/report-failure.ts',
  // dev 模式的 API 请求/响应日志（已脱敏），生产由 isDev 短路。
  'src/services/api/client.ts',
  // Expo DOM 组件跑在 WebView 里，没有 __DEV__ 也没有别名解析。
  'src/features/notes/dom/NoteBlockEditor.dom.tsx',
  // vendored Leaflet 源码字符串。
  'src/features/location/components/leaflet-1.9.4.ts',
  // 模块求值期的配置校验告警；测试 harness 用正则剥类型加载它，不能加 import。
  'src/constants/config.ts',
  // 本地库唯一的输出口，chat-core-local-db-writes.test.js 靠它观测降级路径；
  // 生产信号由同一处的 reportHandledFailure 负责。
  'src/chat-core/local-db.ts',
]);

// reportHandledFailure 的 operation / kind 必须是字符串字面量（sentry.ts 用它们组
// fingerprint）。例外：定义处本身，以及 local-db 的 warn 助手（key 是内部枚举）。
const NON_LITERAL_CALL_ALLOWLIST = new Set([
  'src/observability/report-failure.ts',
  'src/chat-core/local-db.ts',
]);

const STABLE_TAG = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function collectSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') return [];
      return collectSourceFiles(full);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.(test|spec)\.(ts|tsx|mts)$/.test(entry.name)) return [];
    if (/\.test\.mts$/.test(entry.name)) return [];
    return [full];
  });
}

function relative(file) {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

function sourceFiles() {
  return ROOTS.flatMap((root) => collectSourceFiles(path.join(process.cwd(), root)));
}

test('business code never calls console directly (use reportHandledFailure / devWarn)', () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const rel = relative(file);
    if (CONSOLE_ALLOWLIST.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      // 注释里提到 console.warn 是允许的（很多注释在解释为什么不能用它）。
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      const code = line.replace(/\/\/.*$/, '');
      if (/\bconsole\.(log|warn|error|info|debug)\s*\(/.test(code)) {
        offenders.push(`${rel}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `裸 console 调用（生产无信号）：\n  ${offenders.join('\n  ')}`,
  );
});

test('every reportHandledFailure call site uses stable literal operation/kind tags', () => {
  const offenders = [];
  let callSites = 0;
  for (const file of sourceFiles()) {
    const rel = relative(file);
    if (NON_LITERAL_CALL_ALLOWLIST.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const pattern = /reportHandledFailure\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*,/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      callSites += 1;
      const [operation, kind] = [match[1], match[2]].map((raw) => raw.trim());
      for (const arg of [operation, kind]) {
        const literal = /^(['"])(.*)\1$/.exec(arg);
        if (!literal || !STABLE_TAG.test(literal[2])) {
          offenders.push(`${rel}: ${arg}`);
        }
      }
    }
  }
  assert.ok(callSites > 50, `expected the sweep to be wired up, found ${callSites} call sites`);
  assert.deepEqual(
    offenders,
    [],
    `operation/kind 必须是稳定字面量：\n  ${offenders.join('\n  ')}`,
  );
});

test('the root layout routes render errors and unhandled rejections into Sentry', () => {
  const layout = fs.readFileSync(path.join(process.cwd(), 'app/_layout.tsx'), 'utf8');
  assert.match(
    layout,
    /export \{ RouteErrorBoundary as ErrorBoundary \} from '@\/observability\/RouteErrorBoundary';/,
  );
  assert.doesNotMatch(layout, /export \{ ErrorBoundary \} from 'expo-router'/);

  const boundary = fs.readFileSync(
    path.join(process.cwd(), 'src/observability/RouteErrorBoundary.tsx'),
    'utf8',
  );
  assert.match(boundary, /reportError\(error, \{\s*component: 'RouteErrorBoundary'/);

  // silenceDomBridgeRejection 覆盖了 Sentry 自己的 unhandled-rejection 钩子，
  // 它必须把过滤后的 rejection 转发回去。
  const tracker = fs.readFileSync(
    path.join(process.cwd(), 'src/utils/silence-dom-bridge-rejection.ts'),
    'utf8',
  );
  assert.match(tracker, /reportError\(error, \{\s*component: 'promiseRejectionTracker'/);
});
