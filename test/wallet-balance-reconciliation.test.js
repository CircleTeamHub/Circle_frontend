const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadWalletStore() {
  return loadTsModule('src/stores/walletRealtimeStore.ts', {
    requireShim: (request) => {
      if (request === 'zustand') {
        return {
          create: (initializer) => {
            let state;
            const setState = (partial) => {
              const update =
                typeof partial === 'function' ? partial(state) : partial;
              state = update === state ? state : { ...state, ...update };
            };
            const getState = () => state;
            const store = (selector) => selector(state);
            store.getState = getState;
            store.setState = setState;
            state = initializer(setState, getState, store);
            return store;
          },
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  });
}

test('purchase balance applies only if no newer realtime balance arrived', () => {
  const { useWalletRealtimeStore } = loadWalletStore();
  const initialVersion = useWalletRealtimeStore.getState().version;

  assert.equal(
    useWalletRealtimeStore
      .getState()
      .setRealtimeBalanceIfVersion(initialVersion, 800),
    true,
  );
  assert.equal(useWalletRealtimeStore.getState().balance, 800);

  const purchaseVersion = useWalletRealtimeStore.getState().version;
  useWalletRealtimeStore.getState().setRealtimeBalance(900);
  assert.equal(
    useWalletRealtimeStore
      .getState()
      .setRealtimeBalanceIfVersion(purchaseVersion, 700),
    false,
  );
  assert.equal(useWalletRealtimeStore.getState().balance, 900);
});
