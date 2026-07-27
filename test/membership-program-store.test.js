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

function loadStore(fetchStatus) {
  let calls = 0;
  const mod = loadTsModule('src/stores/membershipProgramStore.ts', {
    requireShim: (specifier) => {
      if (specifier === 'zustand') return require('zustand');
      if (specifier === '@/services/api/membership') {
        return {
          fetchMembershipProgramStatus: () => {
            calls += 1;
            return fetchStatus();
          },
        };
      }
      if (specifier === '@/utils/retry') {
        return { retry: (operation) => operation() };
      }
      throw new Error(`unexpected import: ${specifier}`);
    },
  });
  return { store: mod.useMembershipProgramStore, calls: () => calls };
}

test('membership program status is single-flight and cached', async () => {
  const gate = deferred();
  const status = {
    enabled: false,
    enabledAt: null,
    entitlementFloorLevel: 2,
  };
  const { store, calls } = loadStore(() => gate.promise);

  const first = store.getState().fetchStatus();
  const second = store.getState().fetchStatus();
  assert.equal(calls(), 1);
  assert.equal(store.getState().loading, true);

  gate.resolve(status);
  assert.deepEqual(await first, status);
  assert.deepEqual(await second, status);
  assert.deepEqual(store.getState().status, status);
  assert.equal(store.getState().loading, false);

  assert.deepEqual(await store.getState().fetchStatus(), status);
  assert.equal(calls(), 1);
});

test('forced refreshes still coalesce behind the active request', async () => {
  const gate = deferred();
  const status = {
    enabled: true,
    enabledAt: '2026-07-26T00:00:00.000Z',
    entitlementFloorLevel: 0,
  };
  const { store, calls } = loadStore(() => gate.promise);

  const first = store.getState().fetchStatus({ force: true });
  const second = store.getState().fetchStatus({ force: true });
  assert.equal(calls(), 1);

  gate.resolve(status);
  assert.deepEqual(await first, status);
  assert.deepEqual(await second, status);
});

test('failed refresh preserves the last authoritative status', async () => {
  const status = {
    enabled: false,
    enabledAt: null,
    entitlementFloorLevel: 2,
  };
  let fail = false;
  const { store } = loadStore(async () => {
    if (fail) throw new Error('offline');
    return status;
  });

  await store.getState().fetchStatus();
  fail = true;

  assert.deepEqual(
    await store.getState().fetchStatus({ force: true }),
    status,
  );
  assert.deepEqual(store.getState().status, status);
  assert.equal(store.getState().error, 'offline');
});
