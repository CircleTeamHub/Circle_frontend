const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withNativeStorageStubs } = require('./helpers/native-storage-stubs');

function loadPrivacyApi(deps) {
  const filePath = path.join(process.cwd(), 'src/services/api/privacy.ts');
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
    require: withNativeStorageStubs((request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: deps.apiClient,
          isDefinitiveAuthFailure: deps.isDefinitiveAuthFailure ?? (() => false),
        };
      }
      if (request === '@/features/profile/privacy-settings-cache') {
        return deps.cache ?? { writePrivacySettingsCache() {}, clearPrivacySettingsCache() {} };
      }
      if (request === '@/utils/validate') {
        return {
          expectShape: (value, predicate) => {
            if (!predicate(value)) throw new Error('invalid shape');
            return value;
          },
          isPlainObject: (value) => value && typeof value === 'object' && !Array.isArray(value),
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    }),
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('privacy api exposes account-level settings read and patch endpoints', async () => {
  const calls = [];
  const settings = {
    messageSelfDestructSec: 0,
    momentsVisibility: 'ALL',
    allowStrangerMessages: false,
    showPhone: false,
    showEmail: false,
    showWechat: false,
    showQQ: false,
    showWhatsup: false,
    addMeByAccount: true,
    addMeByPhone: true,
    addMeByQrCode: true,
    addMeByGroup: true,
    callPermission: 'EVERYONE',
    groupInvitePermission: 'EVERYONE',
  };
  const api = loadPrivacyApi({
    apiClient: async (endpoint, options) => {
      calls.push({ endpoint, options });
      return settings;
    },
  });

  await api.fetchPrivacySettings();
  await api.updatePrivacySettings({
    allowStrangerMessages: true,
    showPhone: true,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/privacy/settings',
    },
    {
      endpoint: '/privacy/settings',
      options: {
        method: 'PATCH',
        body: {
          allowStrangerMessages: true,
          showPhone: true,
        },
      },
    },
  ]);
});

test('direct-join consent accepts old responses and explicit booleans but rejects coercion', async () => {
  const settings = {
    messageSelfDestructSec: 0, momentsVisibility: 'ALL', allowStrangerMessages: true,
    showPhone: false, showEmail: false, showWechat: false, showQQ: false, showWhatsup: false,
    addMeByAccount: true, addMeByPhone: false, addMeByQrCode: true, addMeByGroup: true,
    callPermission: 'EVERYONE', groupInvitePermission: 'EVERYONE',
  };
  for (const value of [undefined, false, true]) {
    const api = loadPrivacyApi({ apiClient: async () => ({ ...settings, allowFriendGroupDirectJoin: value }) });
    assert.equal((await api.fetchPrivacySettings()).allowFriendGroupDirectJoin, value);
  }
  for (const value of ['true', 'false', 1, null]) {
    const api = loadPrivacyApi({ apiClient: async () => ({ ...settings, allowFriendGroupDirectJoin: value }) });
    await assert.rejects(api.fetchPrivacySettings(), /invalid shape/);
  }
});

test('privacy settings are cached for the session that read them, and dropped on a definitive auth failure', async () => {
  const cacheCalls = [];
  const cache = {
    writePrivacySettingsCache: (epoch, settings) => cacheCalls.push(['write', epoch, settings.showPhone]),
    clearPrivacySettingsCache: (epoch) => cacheCalls.push(['clear', epoch]),
  };
  const valid = {
    messageSelfDestructSec: 0, momentsVisibility: 'ALL', allowStrangerMessages: false,
    showPhone: true, showEmail: false, showWechat: false, showQQ: false, showWhatsup: false,
    addMeByAccount: true, addMeByPhone: true, addMeByQrCode: true, addMeByGroup: true,
    callPermission: 'EVERYONE', groupInvitePermission: 'EVERYONE',
  };
  const unauthorized = new Error('401');
  let next = async () => valid;
  const api = loadPrivacyApi({
    apiClient: () => next(),
    isDefinitiveAuthFailure: (error) => error === unauthorized,
    cache,
  });

  await api.fetchPrivacySettings();
  next = async () => { throw unauthorized; };
  await assert.rejects(api.fetchPrivacySettings(), unauthorized);
  next = async () => { throw new Error('offline'); };
  await assert.rejects(api.fetchPrivacySettings(), /offline/);

  // 默认替身是未登录、sessionEpoch=0;断网不清缓存,只有确定的登录失效才清。
  assert.deepEqual(cacheCalls, [['write', 0, true], ['clear', 0]]);
});
