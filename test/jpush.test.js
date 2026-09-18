const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadJPush(nativeModule, extra = {}, dev = false) {
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
      if (specifier === 'jpush-react-native') return nativeModule;
      return require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('uses the build-configured APNs environment at runtime', () => {
  let initOptions;
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
        assert.equal(options.alert, true);
        assert.equal(options.badge, true);
        assert.equal(options.sound, true);
      },
    },
    { jpushAppKey: 'key', jpushProduction: false },
  );

  assert.equal(api.initializeJPush(), true);
  assert.equal(initOptions.production, false);
  api.requestJPushPermission();
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
