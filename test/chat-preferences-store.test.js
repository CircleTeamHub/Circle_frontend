const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }
      // @/i18n boots the full i18next runtime; stub a defaultValue-echoing t() here.
      if (specifier === '@/i18n') {
        return {
          __esModule: true,
          default: { t: (key, opts) => { let s = (opts && opts.defaultValue) || key; if (opts) for (const k of Object.keys(opts)) if (k !== 'defaultValue') s = s.split('{{' + k + '}}').join(String(opts[k])); return s; }, language: 'zh' },
        };
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

test('chat preferences store defaults each conversation to the global background', () => {
  const { DEFAULT_CHAT_BACKGROUND_PREFERENCE, useChatPreferencesStore } = loadTsModule(
    'src/features/chat/store/use-chat-preferences-store.ts',
    {
      '@react-native-async-storage/async-storage': {
        __esModule: true,
        default: {
          getItem: async () => null,
          setItem: async () => undefined,
          removeItem: async () => undefined,
        },
      },
      // store import 链需要 @/storage 提供的 MMKV-JSON 适配器；测试里给一个
      // 内存版 stub，避免 native MMKV 在 node 环境下抛错。
      '@/storage': {
        mmkvJsonStorage: (() => {
          const store = new Map();
          return {
            getItem: (k) => store.get(k) ?? null,
            setItem: (k, v) => { store.set(k, v); },
            removeItem: (k) => { store.delete(k); },
          };
        })(),
      },
    },
  );

  assert.deepEqual(normalize(DEFAULT_CHAT_BACKGROUND_PREFERENCE), { mode: 'global' });
  assert.deepEqual(
    normalize(
      useChatPreferencesStore.getState().getChatBackgroundPreference('conversation-1'),
    ),
    { mode: 'global' },
  );
});

test('chat preferences store keeps per-conversation preset selections and removes global overrides from storage', () => {
  const { CHAT_BACKGROUND_PRESETS, useChatPreferencesStore } = loadTsModule(
    'src/features/chat/store/use-chat-preferences-store.ts',
    {
      '@react-native-async-storage/async-storage': {
        __esModule: true,
        default: {
          getItem: async () => null,
          setItem: async () => undefined,
          removeItem: async () => undefined,
        },
      },
      // store import 链需要 @/storage 提供的 MMKV-JSON 适配器；测试里给一个
      // 内存版 stub，避免 native MMKV 在 node 环境下抛错。
      '@/storage': {
        mmkvJsonStorage: (() => {
          const store = new Map();
          return {
            getItem: (k) => store.get(k) ?? null,
            setItem: (k, v) => { store.set(k, v); },
            removeItem: (k) => { store.delete(k); },
          };
        })(),
      },
    },
  );

  const preset = CHAT_BACKGROUND_PRESETS[1];
  useChatPreferencesStore
    .getState()
    .setChatBackgroundPreference('conversation-1', {
      mode: 'preset',
      presetId: preset.id,
    });

  assert.deepEqual(
    normalize(
      useChatPreferencesStore.getState().getChatBackgroundPreference('conversation-1'),
    ),
    { mode: 'preset', presetId: preset.id },
  );

  useChatPreferencesStore
    .getState()
    .setChatBackgroundPreference('conversation-1', { mode: 'global' });

  assert.deepEqual(
    normalize(useChatPreferencesStore.getState().backgroundsByConversationID),
    {},
  );
});
