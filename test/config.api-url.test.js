const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadConfigWithEnv(env = {}, options = {}) {
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
module.exports = { API_URL };
`;

  const context = {
    module: { exports: {} },
    exports: {},
    process: { env },
    // These tests exercise URL normalization under a dev build (Expo dev host),
    // so __DEV__ is true and the transport-security guard is a no-op. The guard's
    // release-mode blocking logic is covered directly in transport-security.test.mts.
    __DEV__: options.dev ?? true,
    evaluateTransportGuard: () => null,
    Constants: {
      expoConfig: {
        hostUri: options.hostUri ?? '10.0.0.195:8081',
      },
    },
    Platform: {
      OS: options.platform ?? 'ios',
    },
    APP_DISPLAY_NAME: '风信',
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transformed, context, { filename: filePath });

  return context.module.exports;
}

test('API_URL uses the backend versioned prefix for Expo dev host', () => {
  const { API_URL } = loadConfigWithEnv({}, { hostUri: '10.0.0.195:8081' });

  assert.equal(API_URL, 'http://10.0.0.195:3000/api/v1');
});

test('API_URL normalizes bare EXPO_PUBLIC_API_URL values to the versioned prefix', () => {
  const { API_URL } = loadConfigWithEnv({
    EXPO_PUBLIC_API_URL: 'http://example.com:3000/',
  });

  assert.equal(API_URL, 'http://example.com:3000/api/v1');
});

test('API_URL preserves an explicit versioned path and trims trailing slashes', () => {
  const { API_URL } = loadConfigWithEnv({
    EXPO_PUBLIC_API_URL: 'http://example.com:3000/api/v1///',
  });

  assert.equal(API_URL, 'http://example.com:3000/api/v1');
});

test('release config requires explicit backend transport environment variables', () => {
  assert.throws(
    () => loadConfigWithEnv({}, { dev: false }),
    /EXPO_PUBLIC_API_URL/,
  );
});

test('web static render requires the release API URL before baking the bundle', () => {
  assert.throws(
    () => loadConfigWithEnv({}, { dev: false, platform: 'web' }),
    /EXPO_PUBLIC_API_URL/,
  );

  const { API_URL } = loadConfigWithEnv(
    { EXPO_PUBLIC_API_URL: 'https://api.example.test' },
    { dev: false, platform: 'web' },
  );
  assert.equal(API_URL, 'https://api.example.test/api/v1');
});
