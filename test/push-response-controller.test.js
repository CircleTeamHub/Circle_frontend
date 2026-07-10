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
        content: { data },
      },
    },
  };
}

function harness({ ready = true, resolveRoute = (data) => data.route ?? null } = {}) {
  const navigated = [];
  const localReads = [];
  const apiReads = [];
  const failures = [];
  const diagnostics = [];
  let rejectRead;
  const readPromise = new Promise((resolve, reject) => {
    rejectRead = reject;
  });
  const { createPushResponseController } = load(
    'src/features/notifications/utils/push-response-controller.ts',
  );
  const controller = createPushResponseController({
    resolveRoute,
    navigate: (route) => navigated.push(route),
    markReadLocal: (id) => localReads.push(id),
    markReadRemote: (id) => {
      apiReads.push(id);
      return readPromise;
    },
    reportFailure: (error, id) => failures.push([error.message, id]),
    logOpen: (identifier) => diagnostics.push(identifier),
  });
  controller.setReadiness(ready, ready);
  return {
    controller,
    navigated,
    localReads,
    apiReads,
    failures,
    diagnostics,
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

  h.controller.setReadiness(true, false);
  h.controller.setReadiness(true, true);
  h.controller.setReadiness(true, true);

  assert.deepEqual(h.navigated, ['/target']);
  assert.deepEqual(h.localReads, ['backend-notification-1']);
  assert.deepEqual(h.apiReads, ['backend-notification-1']);
  assert.deepEqual(h.diagnostics, ['expo-request-1']);
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
  assert.deepEqual(h.failures, [['offline', 'backend-failure']]);
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
