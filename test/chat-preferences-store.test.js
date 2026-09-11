const test = require('node:test');
const assert = require('node:assert/strict');

const { loadTsModule } = require('./helpers/load-ts-module');

const PERSIST_KEY = 'circle-im-chat-preferences';

// 纯判断模块零依赖，直接加载真身。此前这里桩了一个「file:// 和 data: URL 都算本地」
// 的谓词，而线上只认 `chat-bg:<name>` —— 迁移测试测的是一套不存在的语义。
const chatBackgroundUri = loadTsModule(
  'src/features/chat/utils/chat-background-uri.ts',
);

/**
 * 每个用例一份全新的 store（loadTsModule 每次都在新的 vm 里跑一遍模块）。
 * 传 seed 就等于「磁盘上已经有这么一份持久化状态」，create() 时会走 rehydrate。
 */
function loadChatPreferencesStore(seed) {
  const cells = new Map();
  if (seed !== undefined) cells.set(PERSIST_KEY, JSON.stringify(seed));

  const module = loadTsModule(
    'src/features/chat/store/use-chat-preferences-store.ts',
    {
      requireShim: (specifier) => {
        if (specifier.endsWith('/chat-background-uri')) return chatBackgroundUri;
        // store 的 import 链需要 @/storage 提供的 MMKV-JSON 适配器；测试里给一个
        // 内存版，避免 native MMKV 在 node 环境下抛错。
        if (specifier === '@/storage') {
          return {
            mmkvJsonStorage: {
              getItem: (key) => cells.get(key) ?? null,
              setItem: (key, value) => {
                cells.set(key, value);
              },
              removeItem: (key) => {
                cells.delete(key);
              },
            },
          };
        }
        return require(specifier);
      },
    },
  );

  return { ...module, cells };
}

// loadTsModule 在独立 realm 里跑，返回的对象/数组原型不同 —— 先过一遍 JSON。
function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

test('chat preferences store defaults each conversation to the global background', () => {
  const { DEFAULT_CHAT_BACKGROUND_PREFERENCE, useChatPreferencesStore } =
    loadChatPreferencesStore();

  assert.deepEqual(normalize(DEFAULT_CHAT_BACKGROUND_PREFERENCE), { mode: 'global' });
  assert.deepEqual(
    normalize(
      useChatPreferencesStore.getState().getChatBackgroundPreference('conversation-1'),
    ),
    { mode: 'global' },
  );
});

test('chat preferences store keeps per-conversation preset selections and removes global overrides from storage', () => {
  const { CHAT_BACKGROUND_PRESETS, useChatPreferencesStore } =
    loadChatPreferencesStore();

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

// ---- v0 → v1 迁移：恒 403 的对象存储直链必须自愈 ----

const V0_STATE = {
  version: 0,
  state: {
    globalBackgroundPreference: {
      mode: 'image',
      uri: 'https://cdn.example.com/chat/user-1/bg.jpg',
    },
    backgroundsByConversationID: {
      remote: { mode: 'image', uri: 'https://cdn.example.com/chat/user-1/a.jpg' },
      local: { mode: 'image', uri: 'chat-bg:bg-1700000000000-abc.jpg' },
      preset: { mode: 'preset', presetId: 'forest-breeze' },
    },
  },
};

test('rehydrating v0 drops the global remote background instead of painting grey', () => {
  const { useChatPreferencesStore } = loadChatPreferencesStore(V0_STATE);

  // `chat/` 前缀不在公开读白名单里：那条直链对匿名 GET 恒 403，图画不出来，
  // 只剩蒙版那层灰。用户不会自己想到「重新选一次图」，所以迁移必须丢掉它。
  assert.equal(
    useChatPreferencesStore.getState().globalBackgroundPreference,
    null,
  );

  // 对照组：同一条路径上的本地背景必须活下来，否则上面那个 null 只是
  // 「根本没水合」的假绿。
  const local = loadChatPreferencesStore({
    version: 1,
    state: {
      globalBackgroundPreference: { mode: 'image', uri: 'chat-bg:bg-2-z.jpg' },
      backgroundsByConversationID: {},
    },
  });
  assert.deepEqual(
    normalize(local.useChatPreferencesStore.getState().globalBackgroundPreference),
    { mode: 'image', uri: 'chat-bg:bg-2-z.jpg' },
  );
});

test('rehydrating v0 drops remote per-conversation backgrounds and keeps the local ones', () => {
  const { useChatPreferencesStore } = loadChatPreferencesStore(V0_STATE);
  const state = useChatPreferencesStore.getState();

  assert.deepEqual(normalize(state.backgroundsByConversationID), {
    local: { mode: 'image', uri: 'chat-bg:bg-1700000000000-abc.jpg' },
    preset: { mode: 'preset', presetId: 'forest-breeze' },
  });
  // 被丢掉的那个会话退回默认（跟随全局），而不是留一个画不出来的引用。
  assert.deepEqual(normalize(state.getChatBackgroundPreference('remote')), {
    mode: 'global',
  });
});

test('rehydrated local backgrounds still resolve to an image, remote ones to the fallback colour', () => {
  const { resolveChatBackgroundStyle, useChatPreferencesStore } =
    loadChatPreferencesStore(V0_STATE);
  const state = useChatPreferencesStore.getState();

  assert.deepEqual(
    normalize(
      resolveChatBackgroundStyle(
        state.getChatBackgroundPreference('local'),
        '#FFFFFF',
      ),
    ),
    { backgroundColor: '#FFFFFF', imageUri: 'chat-bg:bg-1700000000000-abc.jpg' },
  );

  // 迁移之外的兜底：万一有一条漏网的远端 uri，渲染侧也不能把它交给
  // ImageBackground —— 加载必失败，画出来就是那片灰。
  assert.deepEqual(
    normalize(
      resolveChatBackgroundStyle(
        { mode: 'image', uri: 'https://cdn.example.com/chat/user-1/a.jpg' },
        '#FFFFFF',
      ),
    ),
    { backgroundColor: '#FFFFFF' },
  );
});

test('only chat-bg:<name> counts as a local background', () => {
  const { isLocalChatBackgroundImageUri } = chatBackgroundUri;

  assert.equal(isLocalChatBackgroundImageUri('chat-bg:bg-1-a.jpg'), true);
  // 绝对路径（重装后失效）、data: URL（吃光 localStorage 配额）、远端直链（403）
  // 全部不是有效背景 —— 三者都曾经或差点被当成合法值存进偏好。
  assert.equal(
    isLocalChatBackgroundImageUri('file:///var/mobile/Containers/bg.jpg'),
    false,
  );
  assert.equal(isLocalChatBackgroundImageUri('data:image/jpeg;base64,AAAA'), false);
  assert.equal(isLocalChatBackgroundImageUri('https://cdn.example.com/bg.jpg'), false);
  // 路径穿越挡在解析层。
  assert.equal(isLocalChatBackgroundImageUri('chat-bg:../../secrets.txt'), false);
  assert.equal(isLocalChatBackgroundImageUri(null), false);
});
