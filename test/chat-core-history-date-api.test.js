const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

process.env.TZ = 'America/Los_Angeles';

function transpile(rel) {
  const filePath = path.join(process.cwd(), rel);
  return ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
}

function loadDateWindow() {
  const context = { module: { exports: {} }, exports: {} };
  context.exports = context.module.exports;
  vm.runInNewContext(
    transpile('src/features/chat/chat-history-date-window.ts'),
    context,
  );
  return context.module.exports;
}

function loadApi(requests) {
  const context = {
    module: { exports: {} },
    exports: {},
    URLSearchParams,
    Date,
    Intl,
    require: (request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: async (url) => {
            requests.push(url);
            return { messages: [], nextBeforeHeight: null };
          },
        };
      }
      if (request === '@/stores/authStore') {
        return { useAuthStore: { getState: () => ({ sessionEpoch: 1 }) } };
      }
      if (request === './store') {
        return { useChatStore: { getState: () => ({}) } };
      }
      if (request === './deleted-messages') {
        return { withoutLocallyDeleted: (messages) => messages };
      }
      if (request === './clear-history-target') {
        return { getKnownClearTargetHeight: () => null };
      }
      if (request === './local-db') {
        return {
          deleteLocalMessagesBelow: async () => {},
          readRecentLocalMessages: async () => [],
          searchLocalChatMessages: async () => [],
        };
      }
      if (request === '../features/chat/chat-history-date-window') {
        return loadDateWindow();
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile('src/chat-core/api.ts'), context);
  return context.module.exports;
}

test('date search sends both local-midnight offsets across DST changes', async () => {
  const requests = [];
  const { searchChatMessages } = loadApi(requests);

  await searchChatMessages('conv-1', { date: '2026-03-08' });

  const url = new URL(requests[0], 'https://circle.test');
  assert.equal(url.searchParams.get('tzOffsetMinutes'), '480');
  assert.equal(url.searchParams.get('tzEndOffsetMinutes'), '420');
});

test('invalid calendar dates do not issue an unfiltered history request', async () => {
  const requests = [];
  const { searchChatMessages } = loadApi(requests);

  const page = await searchChatMessages('conv-1', { date: '2026-02-30' });

  assert.equal(page.messages.length, 0);
  assert.equal(page.nextBeforeHeight, null);
  assert.equal(requests.length, 0);
});

test('message-day requests send the IANA timezone for DST-aware grouping', async () => {
  const requests = [];
  const { fetchChatMessageDays } = loadApi(requests);

  await fetchChatMessageDays('conv-1', 2026, 2);

  const url = new URL(requests[0], 'https://circle.test');
  assert.equal(url.searchParams.get('timeZone'), 'America/Los_Angeles');
});
