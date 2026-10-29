const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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
    require: (request) => {
      if (request === '@/services/api/client') {
        return { apiClient: deps.apiClient };
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
    },
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
