const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const plain = value => JSON.parse(JSON.stringify(value));

function setup({ breakScopeClear = false } = {}) {
  const diagnostics = loadTsModule('src/utils/client-diagnostics.ts', { context: { __DEV__: false } });
  const users = [];
  const captures = [];
  const clearedScopes = [];
  let options;
  const sdk = {
    init: value => { options = value; },
    wrap: component => component,
    setUser: user => users.push(plain(user)),
    getIsolationScope: () => ({ clearBreadcrumbs() {
      if (breakScopeClear) throw new Error('optional scope clear failed');
      clearedScopes.push('isolation');
    } }),
    getCurrentScope: () => ({ clearBreadcrumbs: () => clearedScopes.push('current') }),
    captureException: (error, context) => captures.push({ error, context }),
  };
  const sentry = loadTsModule('src/observability/sentry.ts', {
    requireShim: request => {
      if (request === '@sentry/react-native') return sdk;
      if (request === 'expo-constants') return { default: { expoConfig: { extra: {} } } };
      if (request === '@/utils/client-diagnostics') return diagnostics;
      return require(request);
    },
    context: { __DEV__: false, process: { env: {} }, console },
  });
  sentry.initSentry({ dsn: 'https://synthetic@example.invalid/42' });
  const event = (user, extra) => ({
    ...(user ? { user } : {}), ...extra,
    exception: { values: [{ type: 'TypeError', value: 'private message' }] },
  });
  return { sentry, diagnostics, options, users, captures, clearedScopes, event };
}

test('SDK user association and final event filtering retain only the internal user id', () => {
  const { sentry, options, users, captures, event } = setup();
  sentry.setSentryUserId(' user-a ');
  assert.deepEqual(users, [{ id: 'user-a' }]);
  const automatic = options.beforeSend(event({ id: 'user-a', email: 'private@example.test', username: 'private-name', ip_address: '192.0.2.1' }));
  assert.deepEqual(plain(automatic.user), { id: 'user-a' });
  assert.doesNotMatch(JSON.stringify(automatic), /private@example|private-name|192\.0\.2\.1|private message/);
  sentry.reportError(new Error('failed'), { operation: 'test', kind: 'capture' });
  assert.deepEqual(plain(captures[0].context.user), { id: 'user-a' });
  assert.deepEqual(plain(options.beforeSend(event(captures[0].context.user, captures[0].context)).user), { id: 'user-a' });
});

test('page history survives busy request diagnostics and retains normalized, timestamped transitions', () => {
  const { sentry, diagnostics, options, event } = setup();
  sentry.setSentryUserId('user-a');
  sentry.setSentryRoute('/(tabs)/profile');
  sentry.setSentryRoute('/(tabs)/profile/collections');
  sentry.setSentryRoute('/(tabs)/messages/user/private-person');
  for (let index = 0; index < 30; index++) diagnostics.logClientDiagnostic('api.request.completed', { method: 'GET', endpointPath: '/collections', status: 200 });
  const captured = options.beforeSend(event({ id: 'user-a' }));
  const history = captured.extra.navigationHistory;
  assert.equal(history.length, 3);
  assert.equal(history[1].from, '/(tabs)/profile');
  assert.equal(history[1].to, '/(tabs)/profile/collections');
  assert.equal(history[2].to, '/(tabs)/messages/user/:id');
  assert.equal(typeof history[1].timestamp, 'number');
  assert.match(history[1].summary, /页面跳转/);
  assert.doesNotMatch(JSON.stringify(history), /private-person/);
});

test('account switches and logout clear both SDK scopes and the previous account diagnostics', () => {
  const { sentry, diagnostics, options, captures, clearedScopes, users, event } = setup();
  sentry.setSentryUserId('user-a');
  sentry.setSentryRoute('/(tabs)/profile/collections');
  diagnostics.logClientDiagnostic('collections.open', { stage: 'voice' });
  sentry.setSentryUserId('user-b');
  sentry.setSentryRoute('/(tabs)/discover');
  const captured = options.beforeSend(event({ id: 'user-b' }));
  assert.equal(captured.tags.previousRoute, undefined);
  assert.equal(captured.extra.navigationHistory.length, 1);
  assert.equal(captured.extra.navigationHistory[0].to, '/(tabs)/discover');
  assert.doesNotMatch(JSON.stringify(captured), /collections|user-a/);
  assert.equal(diagnostics.readDiagnosticBreadcrumbs().length, 0);
  assert.ok(clearedScopes.includes('isolation') && clearedScopes.includes('current'));
  sentry.setSentryUserId(null);
  sentry.reportError(new Error('after logout'));
  assert.equal(captures[0].context.user.id, undefined);
  assert.equal(users.at(-1), null);
});

test('late automatic events keep their captured user but never borrow the new account history', () => {
  const { sentry, diagnostics, options, event } = setup();
  sentry.setSentryUserId('user-a');
  const late = event({ id: 'user-a' });
  sentry.setSentryUserId('user-b');
  sentry.setSentryRoute('/(tabs)/discover');
  diagnostics.logClientDiagnostic('newAccount.action');
  const captured = options.beforeSend(late);
  assert.deepEqual(plain(captured.user), { id: 'user-a' });
  assert.equal(captured.extra?.navigationHistory, undefined);
  assert.equal(captured.extra?.clientDiagnostics, undefined);
  assert.equal(captured.tags?.currentRoute, undefined);
  const anonymous = options.beforeSend(event());
  assert.equal(anonymous.user, undefined);
  assert.equal(anonymous.extra?.clientDiagnostics, undefined);
});

test('manual errors keep a snapshot of identity and page history across a later account switch', () => {
  const { sentry, diagnostics, options, captures, event } = setup();
  sentry.setSentryUserId('user-a');
  sentry.setSentryRoute('/(tabs)/profile/collections');
  diagnostics.logClientDiagnostic('collections.open', { stage: 'voice' });
  sentry.reportError(new Error('failed'), { operation: 'collections', kind: 'voice' });
  sentry.setSentryUserId('user-b');
  sentry.setSentryRoute('/(tabs)/discover');
  diagnostics.logClientDiagnostic('newAccount.action');
  const captured = options.beforeSend(event(captures[0].context.user, captures[0].context));
  assert.equal(captured.user.id, 'user-a');
  assert.equal(captured.extra.navigationHistory[0].to, '/(tabs)/profile/collections');
  assert.match(JSON.stringify(captured), /collections.open/);
  assert.doesNotMatch(JSON.stringify(captured), /newAccount.action|user-b|discover/);
});

test('the installed SDK clears a previous user when applying an anonymous error snapshot', () => {
  const { Scope } = require('@sentry/core');
  const { sentry, captures } = setup();
  sentry.reportError(new Error('anonymous error'));
  const scope = new Scope();
  scope.setUser({ id: 'user-b' });
  scope.update(captures[0].context);
  assert.equal(scope.getUser().id, undefined);
});

test('history is bounded, consecutive duplicate routes are omitted and repeated sanitization is stable', () => {
  const { sentry, options, event } = setup();
  sentry.setSentryUserId('user-a');
  for (let index = 0; index < 25; index++) {
    const route = index % 2 ? '/(tabs)/profile/collections' : '/(tabs)/profile';
    sentry.setSentryRoute(route);
    sentry.setSentryRoute(route);
  }
  const captured = options.beforeSend(event({ id: 'user-a' }));
  assert.equal(captured.extra.navigationHistory.length, 20);
  assert.deepEqual(plain(options.beforeSend(captured)), plain(captured));
});

test('transactions keep only user id, metrics never receive account labels and malformed ids are removed', () => {
  const { sentry, options, event, users } = setup();
  sentry.setSentryUserId('user-a');
  const transaction = options.beforeSendTransaction({ type: 'transaction', transaction: '/(tabs)/profile', user: { id: 'user-a', email: 'private@example.test' } });
  assert.deepEqual(plain(transaction.user), { id: 'user-a' });
  const metric = options.beforeSendMetric({ name: 'api.request.duration', type: 'distribution', value: 12, attributes: { method: 'GET', route: '/collections', outcome: 'success', 'user.id': 'user-a' } });
  assert.equal(metric.attributes['user.id'], undefined);
  assert.equal(options.beforeSend(event({ id: 'private@example.test' })).user, undefined);
  sentry.setSentryUserId('private@example.test');
  assert.equal(users.at(-1), null);
});

test('failure to clear optional SDK breadcrumbs does not block changing the user', () => {
  const { sentry, users } = setup({ breakScopeClear: true });
  assert.doesNotThrow(() => sentry.setSentryUserId('user-a'));
  assert.deepEqual(users.at(-1), { id: 'user-a' });
});
