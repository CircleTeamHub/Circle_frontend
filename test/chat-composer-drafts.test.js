const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

/**
 * 聊天输入框草稿(squady 同款):按账号 + 会话落 MMKV,会话列表显示「[草稿]」。
 * 纯模型(空草稿判定、预览、条数上限)在 src/chat-core/composer-draft-model.test.mts。
 */

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function loadDraftStore() {
  const backing = new Map();
  const shims = {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/storage': {
      mmkvJsonStorage: {
        getItem: (key) => backing.get(key) ?? null,
        setItem: (key, value) => backing.set(key, value),
        removeItem: (key) => backing.delete(key),
      },
    },
  };
  const module = loadTsModule('src/chat-core/composer-drafts.ts', {
    requireShim: (specifier) => {
      if (shims[specifier]) return shims[specifier];
      if (specifier === './composer-draft-model') {
        return loadTsModule('src/chat-core/composer-draft-model.ts');
      }
      throw new Error(`unexpected import: ${specifier}`);
    },
  });
  return { ...module, backing };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('drafts are kept per account and per conversation, and persisted', () => {
  const { useComposerDraftStore, readComposerDraft, backing } = loadDraftStore();
  const store = useComposerDraftStore.getState();

  store.saveDraft('user-a', 'conv-1', {
    text: '晚点再说',
    quoteMessageId: 'm-9',
    mentions: [{ userID: 'u2', nickname: '小王' }],
  });

  assert.equal(readComposerDraft('user-a', 'conv-1').text, '晚点再说');
  // 另一个账号、另一个会话都读不到。
  assert.equal(readComposerDraft('user-b', 'conv-1'), null);
  assert.equal(readComposerDraft('user-a', 'conv-2'), null);
  assert.equal(readComposerDraft(null, 'conv-1'), null);

  const persisted = JSON.parse(backing.get('circle-im-chat-composer-drafts'));
  assert.equal(persisted.state.draftsByUser['user-a']['conv-1'].quoteMessageId, 'm-9');
});

test('saving an empty draft removes it instead of leaving a blank entry behind', () => {
  const { useComposerDraftStore, readComposerDraft } = loadDraftStore();
  const store = useComposerDraftStore.getState();
  store.saveDraft('user-a', 'conv-1', { text: '草稿', quoteMessageId: null, mentions: [] });

  // 删光文字、也没在引用:会话列表不该再挂「[草稿]」。
  useComposerDraftStore
    .getState()
    .saveDraft('user-a', 'conv-1', { text: '   ', quoteMessageId: null, mentions: [] });
  assert.equal(readComposerDraft('user-a', 'conv-1'), null);

  // 只引用、没打字也算草稿(回来还要接着回那一条)。
  useComposerDraftStore
    .getState()
    .saveDraft('user-a', 'conv-1', { text: '', quoteMessageId: 'm-1', mentions: [] });
  assert.equal(readComposerDraft('user-a', 'conv-1').quoteMessageId, 'm-1');
});

test('re-saving identical content does not churn the store', () => {
  const { useComposerDraftStore } = loadDraftStore();
  const input = {
    text: '同一段话',
    quoteMessageId: null,
    mentions: [{ userID: 'u2', nickname: '小王' }],
  };
  useComposerDraftStore.getState().saveDraft('user-a', 'conv-1', input);
  const before = useComposerDraftStore.getState().draftsByUser;
  // 防抖每次都会调:内容没变时不换引用,会话列表不重算。
  useComposerDraftStore.getState().saveDraft('user-a', 'conv-1', plain(input));
  assert.equal(useComposerDraftStore.getState().draftsByUser, before);
});

test('clearing one draft leaves the others alone', () => {
  const { useComposerDraftStore, readComposerDraft } = loadDraftStore();
  const store = useComposerDraftStore.getState();
  store.saveDraft('user-a', 'conv-1', { text: '一', quoteMessageId: null, mentions: [] });
  store.saveDraft('user-a', 'conv-2', { text: '二', quoteMessageId: null, mentions: [] });

  useComposerDraftStore.getState().clearDraft('user-a', 'conv-1');

  assert.equal(readComposerDraft('user-a', 'conv-1'), null);
  assert.equal(readComposerDraft('user-a', 'conv-2').text, '二');
});

test('the conversation list shows a localized draft prefix, but not for the conversation being typed in', () => {
  const screen = read('src/features/messages/screens/MessagesScreen.tsx');
  assert.match(screen, /im\.preview\.draftPrefix/);
  assert.match(screen, /useComposerDraftStore/);
  // 桌面分栏下人正在右边打字:左边那一行不跟着闪「[草稿]」。
  assert.match(
    screen,
    /conversation\.id === activeConversationId\s*\?\s*undefined\s*:\s*composerDrafts\?\.\[conversation\.id\]/,
  );
  // 草稿优先于「发送失败」前缀:两者都有时显示草稿。
  const memo = screen.slice(
    screen.indexOf('const conversations = useMemo'),
    screen.indexOf('setMessagesUnread('),
  );
  assert.ok(
    memo.indexOf('draftPreview') < memo.indexOf('failedIds.has(conversation.id)'),
    'draft must be checked before the failed-send prefix',
  );
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(dict?.im?.preview?.draftPrefix, `${locale} draftPrefix`);
  }
});

test('the chat screen restores and saves drafts, but never while editing a sent message', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /useComposerDraftPersistence\(\{/);
  // 编辑态输入框里是那条已发消息的原文,不是草稿。
  assert.match(screen, /paused: editingMessageId !== null/);
  // 发送成功立刻清掉持久化的那份:只靠防抖保存空草稿,发完 400ms 内被杀进程,
  // 下次打开会话输入框里又是刚发出去的那段话。
  const handleSend = screen.slice(
    screen.indexOf('const handleSend = useCallback'),
    screen.indexOf('}, [', screen.indexOf('const handleSend = useCallback')),
  );
  assert.ok(
    handleSend.indexOf('clearPersistedDraft()') > -1 &&
      handleSend.indexOf('clearPersistedDraft()') <
        handleSend.indexOf("if (mountedRef.current) setDraft('')"),
    'handleSend must clear the persisted draft on success',
  );
  // 收藏/快捷短语走 sendDraftAsText,不消费输入框里的内容,不能顺手把草稿清掉。
  const quickSend = screen.slice(
    screen.indexOf('const sendDraftAsText = useCallback'),
    screen.indexOf('const toggleVoiceInputMode'),
  );
  assert.doesNotMatch(quickSend, /clearPersistedDraft/);
});

test('the draft hook flushes a pending save when the screen goes away', () => {
  const hook = read('src/features/chat/hooks/use-composer-draft.ts');
  assert.match(hook, /useEffect\(\(\) => \(\) => flushSave\(\), \[flushSave\]\)/);
  // 分享带进来的开场白等已经在输入框里的内容不被旧草稿覆盖。
  assert.match(hook, /latestRef\.current\.draft\.length === 0 && saved\.text\.length > 0/);
});
