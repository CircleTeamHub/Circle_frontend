const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 与 config.api-url.test.js 同款 harness:正则剥掉类型后在 vm 里跑真源码。
function loadMediaOrigins(raw) {
  const filePath = path.join(process.cwd(), 'src/constants/config.ts');
  const source = fs.readFileSync(filePath, 'utf8');

  const transformed = `${source
    .replace(/^import .*$/gm, '')
    .replace(/function (\w+)\(([^)]*)\)/g, (_, name, args) => {
      const normalizedArgs = args.replace(
        /([A-Za-z0-9_]+)\s*:\s*[^,)=]+/g,
        '$1',
      );
      return `function ${name}(${normalizedArgs})`;
    })
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    .replace(/\)\s*:\s*[A-Za-z0-9_<>\[\]\s|]+/g, ')')
    .replace(/ as const/g, '')}
module.exports = { MEDIA_ORIGINS };
`;

  const warnings = [];
  const context = {
    module: { exports: {} },
    exports: {},
    process: { env: { EXPO_PUBLIC_MEDIA_ORIGINS: raw } },
    __DEV__: true,
    evaluateTransportGuard: () => null,
    // config.ts 现在导出 RUNTIME_API_TARGET_ID，harness 需要提供这个符号；
    // 真实实现由 src/testing/runtime-api-target.test.mts 直接覆盖。
    buildRuntimeApiTargetId: () => 'windnote_runtime_api_origin_stub',
    URL,
    console: { warn: (message) => warnings.push(String(message)) },
    Constants: { expoConfig: { hostUri: '10.0.0.195:8081' } },
    Platform: { OS: 'ios' },
    APP_DISPLAY_NAME: '风信',
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transformed, context, { filename: 'config.ts' });
  // vm realm 的 Array 原型与宿主不同,deepEqual 会误报 —— 拷回宿主数组再断言。
  return { origins: Array.from(context.module.exports.MEDIA_ORIGINS), warnings };
}

// 上传契约返回独立 fileUrl,对象存储/CDN 可以挂在自己的域名下。
// 没有这份配置的话,那种部署里 allowPeerMediaUrl 会拒掉每一个合法媒体。
test('media origins parse into an explicit allowlist', () => {
  const { origins } = loadMediaOrigins(
    'https://cdn.example.net, https://media.example.org/',
  );
  assert.deepEqual(origins, [
    'https://cdn.example.net',
    'https://media.example.org',
  ]);
});

test('media origins default to empty when unset', () => {
  assert.deepEqual(loadMediaOrigins(undefined).origins, []);
});

test('malformed entries are dropped with a warning, not silently trusted', () => {
  const { origins, warnings } = loadMediaOrigins(
    'https://good.example, not-a-url, ftp://files.example, https://user:pw@creds.example',
  );
  // 一个坏条目不该让整份配置失效,但也绝不能被当成合法来源放行。
  assert.deepEqual(origins, ['https://good.example']);
  assert.equal(warnings.length, 3);
});
