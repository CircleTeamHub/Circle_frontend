const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class TestAvatarFrameResponseValidationError extends Error {
  constructor(message = 'malformed response') {
    super(message);
    this.name = 'AvatarFrameResponseValidationError';
  }
}

function loadStore(fetchUserAppearances) {
  let now = 1_000;
  let nextTimerId = 1;
  const timers = new Map();
  let appStateListener;

  class FakeDate extends Date {
    static now() {
      return now;
    }
  }

  const module = loadTsModule('src/stores/userAppearanceStore.ts', {
    requireShim: (request) => {
      if (request === 'react') {
        return { useEffect: (effect) => effect() };
      }
      if (request === 'react-native') {
        return {
          AppState: {
            addEventListener: (_event, listener) => {
              appStateListener = listener;
              return { remove() {} };
            },
          },
        };
      }
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
      if (request === '@/services/api/avatar-frames') {
        return {
          AvatarFrameResponseValidationError:
            TestAvatarFrameResponseValidationError,
          fetchUserAppearances,
          getInvalidUserAppearanceIds: (result) =>
            result.__invalidIds ?? [],
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
    context: {
      Date: FakeDate,
      setTimeout: (callback, delay) => {
        const id = nextTimerId++;
        timers.set(id, { callback, dueAt: now + delay });
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id);
      },
    },
  });

  async function settle() {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  }

  async function advance(ms) {
    now += ms;
    let ranTimer;
    do {
      ranTimer = false;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt);
      for (const [id, timer] of due) {
        if (!timers.delete(id)) continue;
        timer.callback();
        ranTimer = true;
      }
      await settle();
    } while (ranTimer);
  }

  return {
    ...module,
    advance,
    foreground: () => appStateListener('active'),
    background: () => appStateListener('inactive'),
    now: () => now,
    timerCount: () => timers.size,
  };
}

test('appearance store batches and deduplicates IDs behind the debounce', async () => {
  const calls = [];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return Object.fromEntries(
      ids.map((id) => [id, { vipLevel: 1, avatarFrame: null }]),
    );
  });

  store.requestUserAppearance('alice');
  store.requestUserAppearance('alice');
  store.requestUserAppearance('bob');
  assert.equal(calls.length, 0);

  await store.advance(60);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['alice', 'bob']]);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    1,
  );
});

test('useUserAppearance trims once for both its subscription and request key', async () => {
  const calls = [];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return {
      alice: {
        vipLevel: 3,
        avatarFrame: {
          id: 'frame-1',
          key: 'event-frame',
          name: 'Event frame',
          imageUrl: 'https://cdn.example.com/frame.png',
        },
      },
    };
  });

  assert.equal(store.useUserAppearance(' alice '), undefined);
  await store.advance(60);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['alice']]);
  assert.equal(store.useUserAppearance(' alice ')?.avatarFrame?.id, 'frame-1');
});

test('appearance store never sends more than 200 IDs in one request', async () => {
  const calls = [];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return {};
  });

  for (let index = 0; index < 405; index += 1) {
    store.requestUserAppearance(`user-${index}`);
  }
  await store.advance(60);

  assert.deepEqual(
    calls.map((ids) => ids.length),
    [200, 200, 5],
  );
});

test('appearance cache honors TTL and authoritative omission downgrades to vip0/frame null', async () => {
  const calls = [];
  const responses = [
    {
      alice: {
        vipLevel: 4,
        avatarFrame: {
          id: 'frame-super',
          key: 'membership-super',
          name: 'Super',
          imageUrl: null,
        },
      },
    },
    {},
  ];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return responses.shift();
  });

  store.requestUserAppearance('alice');
  await store.advance(60);
  store.requestUserAppearance('alice');
  await store.advance(60);
  assert.equal(calls.length, 1, 'fresh cache should not refetch');

  await store.advance(5 * 60 * 1000);
  store.requestUserAppearance('alice');
  await store.advance(60);

  assert.equal(calls.length, 2);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        store.useUserAppearanceStore.getState().appearances.alice,
      ),
    ),
    { vipLevel: 0, avatarFrame: null },
  );
  assert.equal(store.useUserAppearanceStore.getState().levels.alice, 0);
});

test('a malformed appearance entry retains only its own cache while valid siblings update', async () => {
  const responses = [
    {
      alice: { vipLevel: 1, avatarFrame: null },
      bob: { vipLevel: 2, avatarFrame: null },
    },
    {
      alice: { vipLevel: 4, avatarFrame: null },
      __invalidIds: ['bob'],
    },
  ];
  const store = loadStore(async () => responses.shift());

  store.requestUserAppearance('alice');
  store.requestUserAppearance('bob');
  await store.advance(60);
  await store.advance(5 * 60 * 1000);
  store.requestUserAppearance('alice');
  store.requestUserAppearance('bob');
  await store.advance(60);

  const state = store.useUserAppearanceStore.getState();
  assert.equal(state.appearances.alice.vipLevel, 4);
  assert.equal(state.appearances.bob.vipLevel, 2);
});

test('a rejected batch retains cached appearance and retries without remounting', async () => {
  const calls = [];
  const responses = [
    { alice: { vipLevel: 3, avatarFrame: null } },
    new Error('malformed response'),
    { alice: { vipLevel: 4, avatarFrame: null } },
  ];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  });

  store.requestUserAppearance('alice');
  await store.advance(60);
  await store.advance(5 * 60 * 1000);
  store.requestUserAppearance('alice');
  await store.advance(60);

  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    3,
  );
  await store.advance(3000);
  await store.advance(60);

  assert.equal(calls.length, 3);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    4,
  );
});

test('a typed malformed batch retains cache, avoids an immediate loop, then recovers after cooldown', async () => {
  const calls = [];
  const responses = [
    { alice: { vipLevel: 3, avatarFrame: null } },
    new TestAvatarFrameResponseValidationError(),
    { alice: { vipLevel: 4, avatarFrame: null } },
  ];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  });

  store.useUserAppearance('alice');
  await store.advance(60);
  await store.advance(5 * 60 * 1000);
  await store.advance(60);
  await store.advance(60 * 1000);
  await store.advance(60);

  assert.equal(calls.length, 2);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    3,
  );

  await store.advance(4 * 60 * 1000);
  await store.advance(60);

  assert.equal(calls.length, 3);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    4,
  );
});

test('appearance store drops a superseded in-flight response', async () => {
  const oldResponse = deferred();
  const newResponse = deferred();
  let call = 0;
  const store = loadStore(async () => {
    call += 1;
    return call === 1 ? oldResponse.promise : newResponse.promise;
  });

  store.requestUserAppearance('alice');
  await store.advance(60);
  store.invalidateUserAppearances();
  store.requestUserAppearance('alice');
  await store.advance(60);

  newResponse.resolve({ alice: { vipLevel: 4, avatarFrame: null } });
  await store.advance(0);
  oldResponse.resolve({ alice: { vipLevel: 1, avatarFrame: null } });
  await store.advance(0);

  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    4,
  );
});

test('equip reconciliation keeps its authoritative frame when an older batch resolves', async () => {
  const oldResponse = deferred();
  const store = loadStore(async () => oldResponse.promise);
  const equippedAppearance = {
    vipLevel: 2,
    avatarFrame: {
      id: 'admin-frame',
      key: 'event-2026',
      name: 'Event frame',
      imageUrl: 'https://cdn.example.com/event.png',
    },
  };

  store.requestUserAppearance('alice');
  await store.advance(60);
  store.reconcileUserAppearance('alice', equippedAppearance);

  oldResponse.resolve({
    alice: { vipLevel: 2, avatarFrame: null },
  });
  await store.advance(0);

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        store.useUserAppearanceStore.getState().appearances.alice,
      ),
    ),
    equippedAppearance,
  );
  assert.equal(store.useUserAppearanceStore.getState().levels.alice, 2);

  store.requestUserAppearance('alice');
  await store.advance(60);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.avatarFrame.id,
    'admin-frame',
    'reconciliation must also mark the authoritative value fresh',
  );
});

test('rapid AppState flapping coalesces a mounted in-flight request', async () => {
  const response = deferred();
  const calls = [];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return response.promise;
  });

  store.useUserAppearance('alice');
  await store.advance(60);
  store.background();
  await store.advance(1000);
  store.foreground();
  store.background();
  await store.advance(1000);
  store.foreground();
  await store.advance(60);

  assert.equal(calls.length, 1);

  response.resolve({ alice: { vipLevel: 4, avatarFrame: null } });
  await store.advance(0);
  await store.advance(60);

  assert.equal(calls.length, 1);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    4,
  );
});

test('a real background queues exactly one refresh behind a pre-background in-flight request', async () => {
  const staleResponse = deferred();
  const freshResponse = deferred();
  const calls = [];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return calls.length === 1 ? staleResponse.promise : freshResponse.promise;
  });

  store.useUserAppearance('alice');
  await store.advance(60);
  store.background();
  await store.advance(30_000);
  store.foreground();
  await store.advance(60);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['alice']]);

  staleResponse.resolve({
    alice: {
      vipLevel: 2,
      avatarFrame: {
        id: 'stale-frame',
        key: 'stale-event',
        name: 'Stale event frame',
        imageUrl: 'https://cdn.example.com/stale.png',
      },
    },
  });
  await store.advance(0);
  await store.advance(60);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['alice'], ['alice']]);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice,
    undefined,
    'the queued pre-background result must not overwrite the newer refresh',
  );

  freshResponse.resolve({
    alice: { vipLevel: 2, avatarFrame: null },
  });
  await store.advance(0);
  await store.advance(60);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['alice'], ['alice']]);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.avatarFrame,
    null,
  );
});

test('foreground refresh clears freshness but keeps visible cache until refresh completes', async () => {
  const calls = [];
  const responses = [
    { alice: { vipLevel: 2, avatarFrame: null } },
    { alice: { vipLevel: 3, avatarFrame: null } },
  ];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return responses.shift();
  });

  store.useUserAppearance('alice');
  await store.advance(60);
  store.background();
  await store.advance(5 * 60 * 1000);
  store.foreground();
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    2,
  );
  await store.advance(60);

  assert.equal(calls.length, 2);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    3,
  );
});

test('a real sub-TTL background refreshes a mounted frame and applies authoritative removal', async () => {
  const calls = [];
  const responses = [
    {
      alice: {
        vipLevel: 2,
        avatarFrame: {
          id: 'event-frame',
          key: 'event-2026',
          name: 'Event frame',
          imageUrl: 'https://cdn.example.com/event.png',
        },
      },
    },
    { alice: { vipLevel: 2, avatarFrame: null } },
  ];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return responses.shift();
  });

  store.useUserAppearance('alice');
  await store.advance(60);
  store.background();
  await store.advance(30_000);
  store.foreground();

  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.avatarFrame.id,
    'event-frame',
    'visible cache should remain until the foreground request resolves',
  );

  await store.advance(60);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['alice'], ['alice']]);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.avatarFrame,
    null,
  );
});

test('a rapid background/foreground cycle within TTL does not refetch', async () => {
  const calls = [];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return { alice: { vipLevel: 2, avatarFrame: null } };
  });

  store.useUserAppearance('alice');
  await store.advance(60);
  store.background();
  await store.advance(1000);
  store.foreground();
  await store.advance(60);

  assert.equal(calls.length, 1);
});

test('one mounted sweep refreshes continuously mounted users after TTL', async () => {
  const calls = [];
  const responses = [
    { alice: { vipLevel: 2, avatarFrame: null } },
    { alice: { vipLevel: 3, avatarFrame: null } },
  ];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return responses.shift();
  });

  store.useUserAppearance('alice');
  await store.advance(60);
  await store.advance(5 * 60 * 1000);
  await store.advance(60);

  assert.equal(calls.length, 2);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    3,
  );
  assert.equal(store.timerCount(), 1, 'mounted users share one sweep timer');
});

test('identical authoritative data preserves the Zustand state reference', async () => {
  const response = {
    alice: {
      vipLevel: 3,
      avatarFrame: {
        id: 'frame-1',
        key: 'membership-diamond',
        name: 'Diamond',
        imageUrl: 'https://cdn.example.com/frame.png',
      },
    },
  };
  const store = loadStore(async () => response);

  store.useUserAppearance('alice');
  await store.advance(60);
  const firstState = store.useUserAppearanceStore.getState();
  await store.advance(5 * 60 * 1000);
  await store.advance(60);

  assert.equal(store.timerCount(), 1);
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.vipLevel,
    3,
  );
  assert.equal(
    store.useUserAppearanceStore.getState().appearances.alice.avatarFrame.key,
    'membership-diamond',
  );
  assert.equal(store.useUserAppearanceStore.getState(), firstState);
});

test('reset cancels pending retries and prevents cross-account in-flight writes', async () => {
  const inFlight = deferred();
  const calls = [];
  const store = loadStore(async (ids) => {
    calls.push(ids);
    return inFlight.promise;
  });

  store.requestUserAppearance('alice');
  await store.advance(60);
  store.invalidateUserAppearances();
  inFlight.resolve({ alice: { vipLevel: 4, avatarFrame: null } });
  await store.advance(0);
  await store.advance(10_000);

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(store.useUserAppearanceStore.getState().appearances),
    ),
    {},
  );
  assert.equal(calls.length, 1);
  assert.equal(store.timerCount(), 0);
});
