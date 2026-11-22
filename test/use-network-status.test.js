const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadProbe(fetchImpl) {
  const calls = [];
  const mod = loadTsModule('src/hooks/use-network-status.ts', {
    context: {
      fetch: (url, init) => {
        calls.push({ url, init });
        return fetchImpl();
      },
      AbortController,
      setTimeout,
      clearTimeout,
    },
    requireShim: (name) => {
      switch (name) {
        case 'react': return { useEffect() {}, useState: (value) => [value, () => {}] };
        case 'react-native': return { AppState: { addEventListener: () => ({ remove() {} }) } };
        case '@/constants/config': return { API_URL: 'https://api.example.com/api/v1' };
        default: return require(name);
      }
    },
  });
  return { probe: mod.probeBackendReachable, calls };
}

test('the reachability probe hits the public liveness endpoint, not an authenticated API', async () => {
  const { probe, calls } = loadProbe(async () => ({ type: 'basic', status: 200 }));
  assert.equal(await probe(), true);
  // 探 /auth/me 时,网页刷新后令牌还没恢复、未登录时每次都是一条 401,还占后端全局限流额度。
  assert.equal(calls[0].url, 'https://api.example.com/healthz');
  assert.equal(calls[0].init.method, 'HEAD');
  // 网页跨域:/healthz 不带 CORS 头,不用 no-cors 浏览器会把响应拦成网络错误,永远显示断网。
  assert.equal(calls[0].init.mode, 'no-cors');
});

test('an opaque cross-origin answer counts as online; a thrown fetch counts as offline', async () => {
  assert.equal(await loadProbe(async () => ({ type: 'opaque', status: 0 })).probe(), true);
  assert.equal(await loadProbe(async () => { throw new TypeError('Failed to fetch'); }).probe(), false);
});
