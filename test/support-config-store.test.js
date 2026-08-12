const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const emptyConfig = () => ({
  recharge: [],
  issue: [],
  dispute: [],
  account: [],
  membership: [],
});

const agent = (userID) => ({
  userID,
  nickname: `nick-${userID}`,
  avatarUrl: null,
  vipLevel: 0,
});

function loadStore(fetchConfig) {
  let calls = 0;
  const mod = loadTsModule('src/stores/supportConfigStore.ts', {
    requireShim: (specifier) => {
      if (specifier === 'zustand') return require('zustand');
      if (specifier === '@/services/api/support') {
        return {
          SUPPORT_CATEGORY_IDS: [
            'recharge',
            'issue',
            'dispute',
            'account',
            'membership',
          ],
          fetchSupportConfig: () => {
            calls += 1;
            return fetchConfig();
          },
        };
      }
      if (specifier === '@/utils/retry') {
        return { retry: (operation) => operation() };
      }
      throw new Error(`unexpected import: ${specifier}`);
    },
  });
  return { store: mod.useSupportConfigStore, calls: () => calls };
}

function loadSelectors() {
  return loadTsModule('src/stores/support-config-selectors.ts', {
    requireShim: (specifier) => {
      throw new Error(`unexpected import: ${specifier}`);
    },
  });
}

test('support config is single-flight and cached', async () => {
  const gate = deferred();
  const config = { ...emptyConfig(), recharge: [agent('u1')] };
  const { store, calls } = loadStore(() => gate.promise);

  // 并发进入客服中心与会员中心时只发一次请求。
  const first = store.getState().fetchConfig();
  const second = store.getState().fetchConfig();
  assert.equal(calls(), 1);

  gate.resolve(config);
  assert.deepEqual(await first, config);
  assert.deepEqual(await second, config);

  // 命中缓存不再打网络。
  await store.getState().fetchConfig();
  assert.equal(calls(), 1);

  // force 才重取 —— 管理台换了客服之后要能看到。
  await store.getState().fetchConfig({ force: true });
  assert.equal(calls(), 2);
});

test('a failed forced refresh expires the cached roster instead of keeping a revoked agent', async () => {
  const config = { ...emptyConfig(), recharge: [agent('u1')] };
  let mode = 'ok';
  const { store } = loadStore(() =>
    mode === 'ok' ? Promise.resolve(config) : Promise.reject(new Error('offline')),
  );

  await store.getState().fetchConfig();
  mode = 'fail';
  const result = await store.getState().fetchConfig({ force: true });

  // fail closed:这份配置是「谁是官方客服」的唯一授权源。管理台撤掉 u1 之后如果
  // 刷新失败还沿用缓存,被撤销的账号会继续以官方客服身份被点开,用户照样把身份、
  // 订单、转账凭证发过去 —— 撤销就永远不生效。宁可空,屏幕据 error 显示重试。
  assert.equal(result, null);
  assert.equal(store.getState().config, null);
  assert.equal(store.getState().error, 'offline');
  assert.equal(store.getState().loading, false);
});

test('failure is distinguishable from an empty roster', async () => {
  const empty = emptyConfig();
  let mode = 'ok';
  const { store } = loadStore(() =>
    mode === 'ok' ? Promise.resolve(empty) : Promise.reject(new Error('offline')),
  );

  // 成功但没配 → 返回对象(五类全空);失败 → null。调用方靠这个区分两种空。
  assert.deepEqual(await store.getState().fetchConfig(), empty);
  mode = 'fail';
  assert.equal(await store.getState().fetchConfig({ force: true }), null);
});

test('a stale in-flight response cannot overwrite a newer one', async () => {
  const slow = deferred();
  const fresh = { ...emptyConfig(), membership: [agent('new')] };
  let call = 0;
  const { store } = loadStore(() => {
    call += 1;
    return call === 1 ? slow.promise : Promise.resolve(fresh);
  });

  const stalePromise = store.getState().fetchConfig();
  // reset 递增 runSequence:此后迟到的第一次响应必须被丢弃。
  store.getState().reset();
  await store.getState().fetchConfig();

  slow.resolve({ ...emptyConfig(), membership: [agent('stale')] });
  await stalePromise;

  assert.deepEqual(store.getState().config, fresh);
});

test('selectSupportAgents never falls back to a default account', () => {
  const { selectSupportAgents } = loadSelectors();
  const config = { ...emptyConfig(), recharge: [agent('u1')] };

  assert.deepEqual(
    [...selectSupportAgents(config, 'recharge')],
    [agent('u1')],
  );
  // 没配 → 空数组。历史上这里回退到 imAdmin,导致入口渲染成功、一点就失败。
  // 用 length 而非 deepEqual([]):沙箱里的 [] 与本 realm 的 [] 原型不同。
  assert.equal(selectSupportAgents(config, 'membership').length, 0);
  assert.equal(selectSupportAgents(null, 'recharge').length, 0);
});
