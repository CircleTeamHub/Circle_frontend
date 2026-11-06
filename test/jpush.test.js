const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadJPush(nativeModule, extra = {}, dev = false, failures = []) {
  const filePath = path.join(
    process.cwd(),
    'src/features/notifications/services/jpush.ts',
  );
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
    __DEV__: dev,
    setTimeout,
    clearTimeout,
    Promise,
    require(specifier) {
      if (specifier === 'react-native') return { Platform: { OS: 'ios' } };
      if (specifier === 'expo-constants') {
        return { __esModule: true, default: { expoConfig: { extra } } };
      }
      if (specifier === '@/observability/report-failure') {
        return { reportHandledFailure: (...args) => failures.push(args) };
      }
      if (specifier === 'jpush-react-native') {
        if (nativeModule instanceof Error) throw nativeModule;
        return nativeModule;
      }
      return require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('reports a configured JPush native module load failure once', () => {
  const failures = [];
  const error = new Error('native JPush module unavailable');
  const api = loadJPush(error, { pushProvider: 'jpush', jpushAppKey: 'key' }, false, failures);

  assert.equal(api.initializeJPush(), false);
  assert.equal(api.initializeJPush(), false);

  assert.deepEqual(failures, [['notifications', 'jpushModuleUnavailable', error]]);
});

test('an unused JPush module does not report when the Expo provider is configured', () => {
  const failures = [];
  const api = loadJPush(new Error('native JPush module unavailable'), { pushProvider: 'expo' }, false, failures);

  assert.equal(api.initializeJPush(), false);
  assert.equal(failures.length, 0);
});

test('uses the build-configured APNs environment at runtime', () => {
  let initOptions;
  let permissionOptions;
  const api = loadJPush(
    {
      init: (options) => {
        initOptions = options;
      },
      addNotificationListener() {},
      getRegistrationID(callback) {
        callback({ registerID: 'registration-id' });
      },
      requestPermission(options) {
        permissionOptions = options;
      },
    },
    { jpushAppKey: 'key', jpushProduction: false },
  );

  assert.equal(api.initializeJPush(), true);
  assert.equal(initOptions.production, false);
  api.requestJPushPermission();
  // iOS 的桥接要带权限选项,不带参数调用会过不了原生参数校验。
  assert.deepEqual({ ...permissionOptions }, { alert: true, badge: true, sound: true });
});

test('waits for a delayed JPush connection before returning a registration ID', async () => {
  let connectListener;
  let reads = 0;
  const api = loadJPush(
    {
      init() {},
      addNotificationListener() {},
      addConnectEventListener(listener) {
        connectListener = listener;
      },
      removeListener() {},
      getRegistrationID(callback) {
        reads += 1;
        callback({ registerID: reads === 1 ? '' : 'registration-id' });
      },
    },
    { jpushAppKey: 'key', jpushProduction: true },
  );

  const registration = api.getJPushRegistrationId();
  await Promise.resolve();
  assert.equal(reads, 1);
  connectListener({ connectEnable: true });
  await assert.doesNotReject(async () => {
    assert.equal(await registration, 'registration-id');
  });
  assert.equal(reads, 2);
});

test('notifies token registration when JPush reconnects after initial sync', () => {
  const connectListeners = [];
  let notified = 0;
  const api = loadJPush(
    {
      init() {},
      addNotificationListener() {},
      addConnectEventListener(listener) {
        connectListeners.push(listener);
      },
      getRegistrationID(callback) {
        callback({ registerID: 'registration-id' });
      },
    },
    { jpushAppKey: 'key', jpushProduction: true },
  );

  api.subscribeJPushConnection(() => {
    notified += 1;
  });
  connectListeners.forEach((listener) => listener({ connectEnable: true }));

  assert.equal(notified, 1);
});
