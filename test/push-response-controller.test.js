const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(rel) {
  const filePath = path.join(process.cwd(), rel);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require,
    setTimeout,
    clearTimeout,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function response(identifier, data = {}) {
  return {
    notification: {
      request: {
        identifier,
        content: { data: { toUserId: 'user-1', ...data } },
      },
    },
  };
}

function fakeScheduler() {
  const scheduled = [];
  return {
    schedule(callback, delayMs) {
      const task = { callback, delayMs, cancelled: false };
      scheduled.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    runNext() {
      const task = scheduled.find((item) => !item.cancelled);
      if (!task) return false;
      task.cancelled = true;
      task.callback();
      return true;
    },
    activeCount() {
      return scheduled.filter((item) => !item.cancelled).length;
    },
    delays() {
      return scheduled.map((item) => item.delayMs);
    },
  };
}

function harness({
  ready = true,
  currentUserId = 'user-1',
  resolveRoute = (data) => data.route ?? null,
  navigate,
  markReadLocal,
  logOpen,
  scheduler,
} = {}) {
  const navigated = [];
  const localReads = [];
  const apiReads = [];
  const failures = [];
  const diagnostics = [];
  const drops = [];
  let rejectRead;
  const readPromise = new Promise((resolve, reject) => {
    rejectRead = reject;
  });
  const { createPushResponseController } = load(
    'src/features/notifications/utils/push-response-controller.ts',
  );
  const controller = createPushResponseController({
    resolveRoute,
    navigate: navigate ?? ((route) => navigated.push(route)),
    markReadLocal: markReadLocal ?? ((id) => localReads.push(id)),
    markReadRemote: (id) => {
      apiReads.push(id);
      return readPromise;
    },
    reportFailure: (error, id, stage) =>
      failures.push([error.message, id, stage]),
    reportDrop: (reason, identifier) => drops.push([reason, identifier]),
    logOpen: logOpen ?? ((identifier) => diagnostics.push(identifier)),
    scheduleRetry: scheduler?.schedule,
  });
  controller.setReadiness(ready, ready ? currentUserId : null);
  return {
    controller,
    navigated,
    localReads,
    apiReads,
    failures,
    diagnostics,
    drops,
    rejectRead,
  };
}

test('queues one cold response and flushes navigation and backend read once when ready', () => {
  const h = harness({ ready: false });
  const cold = response('expo-request-1', {
    route: '/target',
    notificationId: 'backend-notification-1',
  });

  h.controller.handleResponse(cold);
  h.controller.handleResponse(cold);
  assert.deepEqual(h.navigated, []);
  assert.deepEqual(h.localReads, []);

  h.controller.setReadiness(true, null);
  h.controller.setReadiness(true, 'user-1');
  h.controller.setReadiness(true, 'user-1');

  assert.deepEqual(h.navigated, ['/target']);
  assert.deepEqual(h.localReads, ['backend-notification-1']);
  assert.deepEqual(h.apiReads, ['backend-notification-1']);
  assert.deepEqual(h.diagnostics, ['expo-request-1']);
});

test('queues distinct cold responses and flushes them once in arrival order', () => {
  const h = harness({ ready: false });

  h.controller.handleResponse(
    response('expo-cold-1', {
      route: '/cold-1',
      notificationId: 'backend-cold-1',
    }),
  );
  h.controller.handleResponse(
    response('expo-cold-2', {
      route: '/cold-2',
      notificationId: 'backend-cold-2',
    }),
  );
  h.controller.handleResponse(
    response('expo-cold-1', {
      route: '/cold-1',
      notificationId: 'backend-cold-1',
    }),
  );

  h.controller.setReadiness(true, 'user-1');
  h.controller.setReadiness(true, 'user-1');

  assert.deepEqual(h.navigated, ['/cold-1', '/cold-2']);
  assert.deepEqual(h.localReads, ['backend-cold-1', 'backend-cold-2']);
  assert.deepEqual(h.apiReads, ['backend-cold-1', 'backend-cold-2']);
});

test('keeps a cold response queued until its target account becomes active', () => {
  const h = harness({ ready: false });
  h.controller.handleResponse(
    response('expo-account-a', {
      route: '/account-a',
      notificationId: 'backend-account-a',
      toUserId: 'user-a',
    }),
  );

  h.controller.setReadiness(true, 'user-b');
  assert.deepEqual(h.navigated, []);
  assert.deepEqual(h.apiReads, []);

  h.controller.setReadiness(true, 'user-a');
  h.controller.setReadiness(true, 'user-a');
  assert.deepEqual(h.navigated, ['/account-a']);
  assert.deepEqual(h.apiReads, ['backend-account-a']);
});

test('terminally drops a warm response targeted at another account', () => {
  const h = harness({ currentUserId: 'user-b' });
  const mismatch = response('expo-warm-mismatch', {
    route: '/account-a',
    notificationId: 'backend-account-a',
    toUserId: 'user-a',
  });

  h.controller.handleResponse(mismatch);
  h.controller.setReadiness(true, 'user-a');
  h.controller.handleResponse(mismatch);

  assert.deepEqual(h.navigated, []);
  assert.deepEqual(h.apiReads, []);
  assert.deepEqual(h.drops, [
    ['account-mismatch', 'expo-warm-mismatch'],
  ]);
});

test('terminally drops and diagnoses a response missing its target account', () => {
  const h = harness();
  const legacy = response('expo-missing-target', {
    route: '/legacy',
    notificationId: 'backend-legacy',
    toUserId: undefined,
  });

  h.controller.handleResponse(legacy);
  h.controller.handleResponse(
    response('expo-missing-target', {
      route: '/legacy-retry',
      toUserId: 'user-1',
    }),
  );

  assert.deepEqual(h.navigated, []);
  assert.deepEqual(h.apiReads, []);
  assert.deepEqual(h.drops, [
    ['missing-target-user', 'expo-missing-target'],
  ]);
});

test('retains a failed navigation and retries the full FIFO on readiness flush', () => {
  const navigated = [];
  let shouldThrow = true;
  const h = harness({
    ready: false,
    navigate: (route) => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error('router unavailable');
      }
      navigated.push(route);
    },
  });
  h.controller.handleResponse(
    response('expo-retry-1', {
      route: '/retry-1',
      notificationId: 'backend-retry-1',
    }),
  );
  h.controller.handleResponse(
    response('expo-retry-2', {
      route: '/retry-2',
      notificationId: 'backend-retry-2',
    }),
  );

  h.controller.setReadiness(true, 'user-1');
  assert.deepEqual(navigated, []);
  assert.deepEqual(h.apiReads, []);

  h.controller.setReadiness(true, 'user-1');
  h.controller.setReadiness(true, 'user-1');
  assert.deepEqual(navigated, ['/retry-1', '/retry-2']);
  assert.deepEqual(h.apiReads, ['backend-retry-1', 'backend-retry-2']);
  assert.deepEqual(h.failures[0], [
    'router unavailable',
    'backend-retry-1',
    'navigate',
  ]);
});

test('autonomously retries a warm navigation failure without readiness changes', () => {
  const scheduler = fakeScheduler();
  const navigated = [];
  let attempts = 0;
  const h = harness({
    scheduler,
    navigate: (route) => {
      attempts += 1;
      if (attempts === 1) throw new Error('router warming up');
      navigated.push(route);
    },
  });

  h.controller.handleResponse(
    response('expo-auto-retry', {
      route: '/auto-retry',
      notificationId: 'backend-auto-retry',
    }),
  );
  assert.equal(scheduler.activeCount(), 1);
  assert.deepEqual(navigated, []);

  scheduler.runNext();

  assert.deepEqual(navigated, ['/auto-retry']);
  assert.deepEqual(h.apiReads, ['backend-auto-retry']);
  assert.equal(scheduler.activeCount(), 0);
});

test('terminally drops after bounded retries and continues the FIFO', () => {
  const scheduler = fakeScheduler();
  const navigated = [];
  const h = harness({
    ready: false,
    scheduler,
    navigate: (route) => {
      if (route === '/permanent-failure') throw new Error('router rejected');
      navigated.push(route);
    },
  });
  h.controller.handleResponse(
    response('expo-permanent-failure', {
      route: '/permanent-failure',
      notificationId: 'backend-permanent-failure',
    }),
  );
  h.controller.handleResponse(
    response('expo-after-failure', {
      route: '/after-failure',
      notificationId: 'backend-after-failure',
    }),
  );

  h.controller.setReadiness(true, 'user-1');
  assert.equal(scheduler.activeCount(), 1);
  scheduler.runNext();
  assert.equal(scheduler.activeCount(), 1);
  scheduler.runNext();

  assert.deepEqual(navigated, ['/after-failure']);
  assert.deepEqual(h.apiReads, ['backend-after-failure']);
  assert.equal(
    h.failures.filter((item) => item[2] === 'navigate').length,
    3,
  );
  assert.deepEqual(h.drops.at(-1), [
    'navigate-failed',
    'expo-permanent-failure',
  ]);
  assert.deepEqual(scheduler.delays(), [50, 150]);
});

test('a duplicate queued delivery triggers an immediate flush attempt', () => {
  const scheduler = fakeScheduler();
  const navigated = [];
  let shouldFail = true;
  const h = harness({
    scheduler,
    navigate: (route) => {
      if (shouldFail) throw new Error('first attempt failed');
      navigated.push(route);
    },
  });
  const duplicate = response('expo-duplicate-retry', {
    route: '/duplicate-retry',
    notificationId: 'backend-duplicate-retry',
  });

  h.controller.handleResponse(duplicate);
  shouldFail = false;
  h.controller.handleResponse(duplicate);

  assert.deepEqual(navigated, ['/duplicate-retry']);
  assert.deepEqual(h.apiReads, ['backend-duplicate-retry']);
  assert.equal(scheduler.activeCount(), 0);
});

test('dispose cancels scheduled retry navigation', () => {
  const scheduler = fakeScheduler();
  let attempts = 0;
  const h = harness({
    scheduler,
    navigate: () => {
      attempts += 1;
      throw new Error('not ready');
    },
  });

  h.controller.handleResponse(
    response('expo-dispose', { route: '/dispose' }),
  );
  assert.equal(attempts, 1);
  h.controller.dispose();
  assert.equal(scheduler.activeCount(), 0);
  scheduler.runNext();

  assert.equal(attempts, 1);
});

test('contains log and local-read throws after successful navigation', () => {
  const navigated = [];
  const h = harness({
    navigate: (route) => navigated.push(route),
    logOpen: () => {
      throw new Error('diagnostic unavailable');
    },
    markReadLocal: () => {
      throw new Error('store unavailable');
    },
  });
  const notification = response('expo-contained-failures', {
    route: '/still-open',
    notificationId: 'backend-contained',
  });

  h.controller.handleResponse(notification);
  h.controller.handleResponse(notification);

  assert.deepEqual(navigated, ['/still-open']);
  assert.deepEqual(h.apiReads, ['backend-contained']);
  assert.deepEqual(h.failures.slice(0, 2), [
    ['diagnostic unavailable', 'backend-contained', 'log-open'],
    ['store unavailable', 'backend-contained', 'local-read'],
  ]);
});

test('bounds the pending queue and lets an overflowed response retry later', () => {
  const h = harness({ ready: false });
  for (let index = 0; index <= 50; index += 1) {
    h.controller.handleResponse(
      response(`expo-overflow-${index}`, {
        route: `/overflow-${index}`,
        notificationId: `backend-overflow-${index}`,
      }),
    );
  }

  h.controller.setReadiness(true, 'user-1');

  assert.deepEqual(
    h.navigated,
    Array.from({ length: 50 }, (_, index) => `/overflow-${index + 1}`),
  );
  assert.deepEqual(
    h.apiReads,
    Array.from(
      { length: 50 },
      (_, index) => `backend-overflow-${index + 1}`,
    ),
  );

  h.controller.handleResponse(
    response('expo-overflow-0', {
      route: '/overflow-0-retry',
      notificationId: 'backend-overflow-0',
    }),
  );
  assert.equal(h.navigated.at(-1), '/overflow-0-retry');
  assert.equal(h.apiReads.at(-1), 'backend-overflow-0');
});

test('handles a warm response immediately and navigates without a backend notification id', () => {
  const h = harness();

  h.controller.handleResponse(response('expo-request-2', { route: '/warm' }));

  assert.deepEqual(h.navigated, ['/warm']);
  assert.deepEqual(h.localReads, []);
  assert.deepEqual(h.apiReads, []);
});

test('dedupes get-last and listener delivery by Expo request identifier', () => {
  const h = harness();
  const duplicate = response('same-expo-id', {
    route: '/same',
    notificationId: 'backend-id',
  });

  h.controller.handleResponse(duplicate);
  h.controller.handleResponse(duplicate);

  assert.deepEqual(h.navigated, ['/same']);
  assert.deepEqual(h.apiReads, ['backend-id']);
});

test('ignores unknown routes without remembering their request identifiers', () => {
  let known = false;
  const h = harness({ resolveRoute: (data) => (known ? data.route : null) });
  const notification = response('initially-unknown', { route: '/later' });

  h.controller.handleResponse(notification);
  known = true;
  h.controller.handleResponse(notification);

  assert.deepEqual(h.navigated, ['/later']);
});

test('bounds remembered Expo request identifiers at 300', () => {
  const h = harness();
  for (let index = 0; index <= 300; index += 1) {
    h.controller.handleResponse(response(`expo-${index}`, { route: `/route-${index}` }));
  }

  h.controller.handleResponse(response('expo-0', { route: '/route-0-again' }));

  assert.equal(h.navigated.length, 302);
  assert.equal(h.navigated.at(-1), '/route-0-again');
});

test('reports remote read failure without blocking navigation', async () => {
  const h = harness();

  h.controller.handleResponse(
    response('expo-request-3', {
      route: '/failure-still-navigates',
      notificationId: 'backend-failure',
    }),
  );
  assert.deepEqual(h.navigated, ['/failure-still-navigates']);

  h.rejectRead(new Error('offline'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(h.failures, [
    ['offline', 'backend-failure', 'remote-read'],
  ]);
});

test('recognizes encoded profile user target for replace navigation', () => {
  const { isAlreadyOnPushTarget } = load(
    'src/features/notifications/utils/push-response-controller.ts',
  );

  assert.equal(
    isAlreadyOnPushTarget('/messages/user/user%20%2F%208', {
      pathname: '/(tabs)/messages/user/[id]',
      params: { id: 'user / 8' },
    }),
    true,
  );
  assert.equal(
    isAlreadyOnPushTarget('/messages/user/someone-else', {
      pathname: '/(tabs)/messages/user/[id]',
      params: { id: 'user / 8' },
    }),
    false,
  );
});

test('registers the listener before reading and clearing the last response', () => {
  const { initializePushResponseListener } = load(
    'src/features/notifications/utils/push-response-listener.ts',
  );
  const operations = [];
  const handled = [];
  const arriving = response('expo-init-overlap', { route: '/overlap' });
  let listener;
  const subscription = { remove() {} };
  const notifications = {
    addNotificationResponseReceivedListener(callback) {
      operations.push('listen');
      listener = callback;
      return subscription;
    },
    getLastNotificationResponse() {
      operations.push('get-last');
      listener(arriving);
      return arriving;
    },
    clearLastNotificationResponse() {
      operations.push('clear-last');
    },
  };
  const seen = new Set();

  const result = initializePushResponseListener(notifications, (item) => {
    const identifier = item.notification.request.identifier;
    if (seen.has(identifier)) return;
    seen.add(identifier);
    handled.push(identifier);
  });

  assert.equal(result, subscription);
  assert.deepEqual(operations, ['listen', 'get-last', 'clear-last']);
  assert.deepEqual(handled, ['expo-init-overlap']);
});
