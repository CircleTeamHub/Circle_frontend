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

test('friend api exposes helpers for remark, settings, and tag editing', async () => {
  const calls = [];
  const api = loadFriendsApi({
    apiClient: async (endpoint, options) => {
      calls.push({ endpoint, options });
      return [];
    },
    normalizeMediaUrl: (value) => value,
  });

  await api.fetchFriendSettings('friend-1');
  await api.setFriendRemark('friend-1', '  老同事  ');
  await api.assignFriendTag('friend-1', 'tag-1');
  await api.removeFriendTag('friend-1', 'tag-2');
  await api.createFriendTag('  高中同学  ');

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { endpoint: '/friend/friend-1/settings' },
    {
      endpoint: '/friend/friend-1/remark',
      options: { method: 'PATCH', body: { remark: '老同事' } },
    },
    {
      endpoint: '/friend/friend-1/tags',
      options: { method: 'POST', body: { tagId: 'tag-1' } },
    },
    {
      endpoint: '/friend/friend-1/tags/tag-2',
      options: { method: 'DELETE' },
    },
    {
      endpoint: '/friend/tags',
      options: { method: 'POST', body: { name: '高中同学' } },
    },
  ]);
});

test('friend remark and tag editor screens load settings and save through real APIs', () => {
  const remarkSource = read('src/features/user/screens/EditFriendRemarkScreen.tsx');
  const tagSource = read('src/features/user/screens/EditFriendTagsScreen.tsx');
  const contactsRemarkRoute = read('app/(tabs)/contacts/user/[id]/remark.tsx');
  const contactsTagsRoute = read('app/(tabs)/contacts/user/[id]/tags.tsx');

  assert.match(remarkSource, /fetchFriendSettings/);
  assert.match(remarkSource, /setFriendRemark/);
  assert.match(remarkSource, /router\.back\(\)/);

  assert.match(tagSource, /fetchFriendSettings/);
  assert.match(tagSource, /createFriendTag/);
  assert.match(tagSource, /assignFriendTag/);
  assert.match(tagSource, /removeFriendTag/);
  assert.match(tagSource, /router\.back\(\)/);
  assert.match(tagSource, /新建标签/);

  assert.match(contactsRemarkRoute, /EditFriendRemarkScreen/);
  assert.match(contactsTagsRoute, /EditFriendTagsScreen/);
});
