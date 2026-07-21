const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { loadTsModule } = require('./helpers/load-ts-module');

const SRC = path.join(process.cwd(), 'src');

function collectSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/**
 * 找出所有「上报给 Sentry 的 context 字面量」——即带 operation 属性的对象字面量。
 * 用 AST 而不是正则：源码里还有名为 operation 的函数参数
 * （push-token-registration 的 enqueueRemoteMutation），正则会误伤。
 */
function findReportContexts() {
  const found = [];
  for (const file of collectSourceFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.ES2020,
      true,
      /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const names = node.properties
          .map((p) => p.name && ts.isIdentifier(p.name) && p.name.text)
          .filter(Boolean);
        if (names.includes('operation')) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          found.push({
            file: path.relative(process.cwd(), file),
            line: line + 1,
            names,
            // 展开的属性静态看不见（upload.ts 的 kind 就是 ...context 带进来的），
            // 所以「有没有 kind」这个判断对含展开的字面量不成立，只能放过。
            hasSpread: node.properties.some(ts.isSpreadAssignment),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
}

// sentry.ts 的 buildCaptureContext 用 [operation, kind, failureKind] 组 fingerprint，
// 而 tagKeys 里只有 kind——写成 op 不会报错、不会进 tags，只会静默 fallback 成
// 'unknown-kind'，把该 operation 下所有不同故障合并成同一条 issue。
// 这类错误没有任何运行时信号，只能在这里守住。
test('every Sentry report context that sets operation also sets kind', () => {
  const offenders = findReportContexts().filter(
    (ctx) => !ctx.hasSpread && !ctx.names.includes('kind'),
  );

  assert.deepEqual(
    offenders.map((o) => `${o.file}:${o.line}`),
    [],
    `这些上报 context 少了 kind，fingerprint 会塌成 'unknown-kind'：\n` +
      offenders
        .map((o) => `  ${o.file}:${o.line}  [${o.names.join(', ')}]`)
        .join('\n'),
  );
});

test('no Sentry report context uses op instead of kind', () => {
  const offenders = findReportContexts().filter((ctx) => ctx.names.includes('op'));

  assert.deepEqual(
    offenders.map((o) => `${o.file}:${o.line}`),
    [],
    `op 不在 sentry.ts 的 tagKeys 里，不会成为 tag，也不参与 fingerprint：\n` +
      offenders
        .map((o) => `  ${o.file}:${o.line}  [${o.names.join(', ')}]`)
        .join('\n'),
  );
});

function loadSentry() {
  return loadTsModule('src/observability/sentry.ts', {
    requireShim: (request) => {
      switch (request) {
        case '@sentry/react-native':
          return { init() {}, wrap: (c) => c, captureException() {} };
        case 'expo-constants':
          return { default: { expoConfig: { extra: {} } } };
        case '@/utils/client-diagnostics':
          return { readDiagnosticBreadcrumbs: () => [] };
        default:
          return require(request);
      }
    },
    context: { __DEV__: false, process: { env: {} }, console },
  });
}

// 上面两条是源码级契约，这条说明它为什么值得守：同一 operation 下的不同故障，
// 只有 kind 能把它们分开。
test('distinct kinds under one operation produce distinct fingerprints', () => {
  const { reportError } = loadSentry();
  const captured = [];
  const sink = { captureException: (error, ctx) => captured.push(ctx) };

  reportError(new Error('a'), { operation: 'openim', kind: 'login' }, sink);
  reportError(new Error('b'), { operation: 'openim', kind: 'sendMessage' }, sink);

  assert.equal(captured[0].tags.kind, 'login');
  assert.equal(captured[1].tags.kind, 'sendMessage');
  assert.notEqual(
    captured[0].fingerprint.join('|'),
    captured[1].fingerprint.join('|'),
  );
});
