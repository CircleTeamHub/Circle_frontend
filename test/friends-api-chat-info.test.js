const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function loadFriendsApi(deps) {
  const filePath = path.join(process.cwd(), 'src/services/api/friends.ts');
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

      if (request === '@/services/api/utils') {
        return { normalizeMediaUrl: deps.normalizeMediaUrl };
      }

      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('friends api exposes blacklist and delete-friend actions through the backend contract', async () => {
  const calls = [];
  const api = loadFriendsApi({
    apiClient: async (endpoint, options) => {
      calls.push({ endpoint, options });
      if (endpoint === '/friend/blocked') {
        return [];
      }
      return undefined;
    },
    normalizeMediaUrl: (value) => value,
  });

  await api.addFriendToBlacklist('friend-1');
  await api.removeFriendFromBlacklist('friend-1');
  await api.fetchBlockedUsers();
  await api.deleteFriendRelationship('friend-1');

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/friend/block',
      options: { method: 'POST', body: { targetId: 'friend-1' } },
    },
    {
      endpoint: '/friend/block/friend-1',
      options: { method: 'DELETE' },
    },
    {
      endpoint: '/friend/blocked',
    },
    {
      endpoint: '/friend/friend-1',
      options: { method: 'DELETE' },
    },
  ]);
});

test('chat info screen routes blacklist, delete, and report through real friend APIs', () => {
  const source = read('src/features/chat/screens/ChatInfoScreen.tsx');

  assert.match(source, /addFriendToBlacklist/);
  assert.match(source, /removeFriendFromBlacklist/);
  assert.match(source, /deleteFriendRelationship/);
  assert.match(source, /const handleToggleBlacklist = useCallback/);
  assert.match(source, /const handleConfirmDeleteContact = useCallback/);
  assert.match(source, /Alert\.alert\(\s*t\('chat\.deleteFriend'\)/);
  assert.match(source, /label=\{t\('chat\.addBlacklist'\)\}/);
  assert.match(source, /onToggle={handleToggleBlacklist}/);
  assert.match(source, /label=\{t\('chat\.deleteFriend'\)\}/);
  assert.match(source, /onPress={deletePending \? undefined : handleConfirmDeleteContact}/);
  // chat.report became an object namespace (report screen keys); the row label
  // now uses the report-screen title string chat.report.title (same "投诉举报").
  assert.match(source, /label=\{t\('chat\.report\.title'\)\}/);
  assert.match(source, /messages\/report-friend/);
  assert.doesNotMatch(source, /openUnsupportedAction\(t\('chat\.report\.title'\)\)/);
  assert.doesNotMatch(source, /openUnsupportedAction\(t\('chat\.deleteFriend'\)\)/);
});

test('report friend screen explains successful friend reports affect reputation', () => {
  const source = read('src/features/chat/screens/ReportFriendScreen.tsx');

  assert.match(source, /有效举报会影响对方信誉值/);
});
