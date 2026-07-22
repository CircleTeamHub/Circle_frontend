const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// FE#87：MMKV 整库加密初始化（密钥在 SecureStore、明文库 recrypt 就地迁移、
// 密钥在库坏时清库重建）+ storage 同步壳的未就绪回退。

function transpile(relPath) {
  const filePath = path.join(process.cwd(), relPath);
  const source = fs.readFileSync(filePath, 'utf8');
  return {
    filePath,
    code: ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filePath,
    }).outputText,
  };
}

function makeMMKVInstance(calls, { failRecrypt = false } = {}) {
  const data = new Map();
  return {
    data,
    getString: (key) => (data.has(key) ? data.get(key) : undefined),
    getBoolean: (key) => (data.has(key) ? data.get(key) : undefined),
    set: (key, value) => {
      data.set(key, value);
    },
    remove: (key) => {
      data.delete(key);
    },
    contains: (key) => data.has(key),
    clearAll: () => {
      calls.push(['clearAll']);
      data.clear();
    },
    recrypt: (key) => {
      calls.push(['recrypt', key]);
      if (failRecrypt) throw new Error('recrypt failed');
    },
  };
}

function loadEncryptedInit({
  storedKey = null,
  openBehavior = () => undefined, // 返回 undefined = 正常；抛错 = 打不开
} = {}) {
  const calls = [];
  const secure = new Map();
  if (storedKey) secure.set('circle-im-mmkv-encryption-key', storedKey);

  const instances = [];
  const requireShim = (request) => {
    if (request === 'expo-secure-store') {
      return {
        getItemAsync: async (key) => {
          calls.push(['secure:get', key]);
          return secure.has(key) ? secure.get(key) : null;
        },
        setItemAsync: async (key, value) => {
          calls.push(['secure:set', key]);
          secure.set(key, value);
        },
      };
    }
    if (request === 'expo-crypto') {
      return {
        getRandomBytesAsync: async (length) => {
          calls.push(['randomBytes', length]);
          return Uint8Array.from({ length }, (_, i) => i);
        },
      };
    }
    if (request === 'react-native-mmkv') {
      return {
        createMMKV: (config) => {
          calls.push(['createMMKV', config]);
          openBehavior(config);
          const instance = makeMMKVInstance(calls);
          instances.push(instance);
          return instance;
        },
      };
    }
    throw new Error(`Unexpected import: ${request}`);
  };

  const { filePath, code } = transpile('src/storage/encrypted-init.ts');
  const context = {
    module: { exports: {} },
    exports: {},
    require: requireShim,
    console,
    __DEV__: false,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(code, context, { filename: filePath });
  return { mod: context.module.exports, calls, secure, instances };
}

test('fresh install: generates hex key, stores it, opens plaintext then recrypts in place', async () => {
  const { mod, calls, secure } = loadEncryptedInit();

  assert.equal(mod.getEncryptedInstance(), null);
  await mod.initEncryptedStorage();

  const storedKey = secure.get('circle-im-mmkv-encryption-key');
  assert.match(storedKey, /^[0-9a-f]{64}$/);

  const creates = calls.filter(([op]) => op === 'createMMKV');
  assert.equal(creates.length, 1);
  // 首启走「明文打开 + recrypt」而不是带 encryptionKey 直开
  //（vm 内创建的对象跨 realm，deepEqual 会因原型不同误报 —— 逐字段断言）
  assert.equal(creates[0][1].id, 'circle-im');
  assert.equal('encryptionKey' in creates[0][1], false);
  assert.deepEqual(
    calls.filter(([op]) => op === 'recrypt'),
    [['recrypt', storedKey]],
  );
  assert.ok(mod.getEncryptedInstance());
});

test('existing key: opens directly with encryptionKey, no recrypt', async () => {
  const key = 'ab'.repeat(32);
  const { mod, calls } = loadEncryptedInit({ storedKey: key });

  await mod.initEncryptedStorage();

  const creates = calls.filter(([op]) => op === 'createMMKV');
  assert.equal(creates.length, 1);
  assert.equal(creates[0][1].id, 'circle-im');
  assert.equal(creates[0][1].encryptionKey, key);
  assert.equal(calls.some(([op]) => op === 'recrypt'), false);
});

test('key survives but store will not open: wipes and re-encrypts instead of crashing', async () => {
  const key = 'cd'.repeat(32);
  let attempts = 0;
  const { mod, calls } = loadEncryptedInit({
    storedKey: key,
    openBehavior: (config) => {
      attempts += 1;
      // 第一次（带密钥）打不开；恢复路径的明文打开放行
      if (config.encryptionKey) throw new Error('cannot decrypt');
    },
  });

  await mod.initEncryptedStorage();

  assert.equal(attempts, 2);
  assert.ok(calls.some(([op]) => op === 'clearAll'));
  assert.deepEqual(
    calls.filter(([op]) => op === 'recrypt'),
    [['recrypt', key]],
  );
  assert.ok(mod.getEncryptedInstance());
});

test('init is idempotent: concurrent calls share one initialization', async () => {
  const { mod, calls } = loadEncryptedInit({ storedKey: 'ef'.repeat(32) });

  const [a, b] = await Promise.all([
    mod.initEncryptedStorage(),
    mod.initEncryptedStorage(),
  ]);
  await mod.initEncryptedStorage();

  assert.equal(a, b);
  assert.equal(calls.filter(([op]) => op === 'secure:get').length, 1);
  assert.equal(calls.filter(([op]) => op === 'createMMKV').length, 1);
});

// ---- storage 同步壳（src/storage/index.ts）----

function loadStorageShell() {
  let instance = null;
  let resolveInit;
  const initPromise = new Promise((resolve) => {
    resolveInit = resolve;
  });
  const calls = [];

  const requireShim = (request) => {
    if (request === './encrypted-init') {
      return {
        getEncryptedInstance: () => instance,
        initEncryptedStorage: () => initPromise,
      };
    }
    if (request === '@react-native-async-storage/async-storage') {
      return {
        default: {
          multiGet: async (keys) => keys.map((key) => [key, null]),
          multiRemove: async () => undefined,
        },
      };
    }
    throw new Error(`Unexpected import: ${request}`);
  };

  const { filePath, code } = transpile('src/storage/index.ts');
  const context = {
    module: { exports: {} },
    exports: {},
    require: requireShim,
    console,
    __DEV__: false,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(code, context, { filename: filePath });

  return {
    mod: context.module.exports,
    calls,
    completeInit: () => {
      instance = makeMMKVInstance(calls);
      resolveInit(instance);
      return instance;
    },
  };
}

test('shell before init: reads fall back, writes are dropped, nothing throws', () => {
  const { mod } = loadStorageShell();

  assert.equal(mod.storage.getString('k'), undefined);
  assert.equal(mod.storage.getBoolean('k'), undefined);
  assert.equal(mod.storage.contains('k'), false);
  assert.doesNotThrow(() => mod.storage.set('k', 'v'));
  assert.doesNotThrow(() => mod.storage.remove('k'));
  assert.doesNotThrow(() => mod.storage.clearAll());
});

test('mmkvJsonStorage before init: defers to async init and lands the write', async () => {
  const { mod, completeInit } = loadStorageShell();

  const pendingSet = mod.mmkvJsonStorage.setItem('store-key', '{"a":1}');
  assert.ok(pendingSet instanceof Promise);
  const pendingGet = mod.mmkvJsonStorage.getItem('store-key');
  assert.ok(pendingGet instanceof Promise);

  const instance = completeInit();
  await pendingSet;
  assert.equal(await pendingGet, '{"a":1}');
  assert.equal(instance.getString('store-key'), '{"a":1}');
});

test('shell after init: delegates synchronously to the encrypted instance', () => {
  const { mod, completeInit } = loadStorageShell();
  const instance = completeInit();

  mod.storage.set('k', 'v');
  assert.equal(mod.storage.getString('k'), 'v');
  assert.equal(mod.storage.contains('k'), true);
  // 同步路径不再返回 Promise
  assert.equal(mod.mmkvJsonStorage.getItem('k'), 'v');
  mod.storage.remove('k');
  assert.equal(instance.contains('k'), false);
});
