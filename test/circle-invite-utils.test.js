const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(rel) {
  const filePath = path.join(process.cwd(), rel);
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
    require: (specifier) => {
      if (specifier === '@/im/client') {
        return {
          toImUserId: (value) => String(value).replace(/-/g, ''),
        };
      }
      return specifier.startsWith('@/') ? {} : require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('circle invite utils filter out friends already present in the backing group', () => {
  const {
    buildExistingCircleMemberIds,
    filterInvitableCircleFriends,
  } = load('src/features/discover/utils/circle-invite.ts');

  // chat-core:成员 userId 与好友 id 同形(UUID),直接同值比较。
  const existing = buildExistingCircleMemberIds([
    { userId: 'user-one' },
    { userId: 'user-two' },
  ]);
  const friends = [
    { id: 'user-one', nickname: 'One', accountId: 'one' },
    { id: 'user-two', nickname: 'Two', accountId: 'two' },
    { id: 'user-three', nickname: 'Three', accountId: 'three' },
  ];

  assert.deepEqual(
    filterInvitableCircleFriends(friends, existing).map((friend) => friend.id),
    ['user-three'],
  );
});

test('circle invite utils prune selected users who become known existing members', () => {
  const {
    buildExistingCircleMemberIds,
    pruneSelectedCircleInvitees,
  } = load('src/features/discover/utils/circle-invite.ts');

  const selected = {
    'user-one': true,
    'user-two': true,
  };
  const existing = buildExistingCircleMemberIds([{ userId: 'user-one' }]);

  assert.deepEqual({ ...pruneSelectedCircleInvitees(selected, existing) }, {
    'user-two': true,
  });
});
