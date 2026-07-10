const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(__dirname, '..', rel));

function loadRoutes() {
  const filePath = path.join(__dirname, '..', 'src/features/user/utils/routes.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const moduleObj = { exports: {} };
  new Function('module', 'exports', 'require', transpiled)(
    moduleObj,
    moduleObj.exports,
    require,
  );
  return moduleObj.exports;
}

const normalize = (value) => JSON.parse(JSON.stringify(value));

test('circle detail and its sub-flow are mirrored under the messages stack', () => {
  // 聊天里的圈子名片/验证卡在本 tab 内打开（从哪进从哪出），
  // 需要 messages 栈有完整镜像。
  for (const rel of [
    'app/(tabs)/messages/circle/[id].tsx',
    'app/(tabs)/messages/circle/[id]/admin.tsx',
    'app/(tabs)/messages/circle/[id]/edit.tsx',
    'app/(tabs)/messages/circle/[id]/invite.tsx',
    'app/(tabs)/messages/circle/[id]/invite-friends.tsx',
    'app/(tabs)/messages/circle/[id]/share.tsx',
    'app/(tabs)/messages/invitation/[id].tsx',
    'app/(tabs)/messages/invitation/[id]/select-verifier.tsx',
    'app/(tabs)/messages/verification/[id].tsx',
  ]) {
    assert.ok(exists(rel), `missing mirror route: ${rel}`);
  }
});

test('chat cards open circle/verification within the current tab', () => {
  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');

  assert.match(chat, /getCircleDetailHref\(/);
  assert.match(chat, /getVerificationDetailHref\(/);
  // 不允许再硬编码跨 tab 押到 discover。
  assert.doesNotMatch(chat, /discover\/circle\/\$\{/);
  assert.doesNotMatch(chat, /'\/\(tabs\)\/discover\/verification\/\[id\]'/);
});

test('circle screens derive scope from segments for every internal push', () => {
  const detail = read('src/features/discover/screens/CircleDetailScreen.tsx');
  const inviteMenu = read(
    'src/features/discover/screens/InviteCircleMenuScreen.tsx',
  );
  const invitation = read(
    'src/features/discover/screens/InvitationVerificationScreen.tsx',
  );

  assert.match(detail, /getCircleScopeFromSegments\(segments\)/);
  for (const helper of [
    'getCircleEditHref',
    'getCircleInviteHref',
    'getCircleAdminHref',
    'getInvitationDetailHref',
  ]) {
    assert.match(detail, new RegExp(`${helper}\\(\\s*circleScope`));
  }
  // 进入群聊按 scope 选栈。
  assert.match(
    detail,
    /circleScope === 'messages'\s*\?\s*'\/\(tabs\)\/messages\/chat-detail'/,
  );
  assert.doesNotMatch(detail, /'\/\(tabs\)\/discover\/circle\/\[id\]\/(edit|invite|admin)'/);

  assert.match(inviteMenu, /getCircleShareHref\(circleScope/);
  assert.match(inviteMenu, /getCircleInviteFriendsHref\(circleScope/);
  assert.match(invitation, /getSelectVerifierHref\(getCircleScopeFromSegments\(segments\)/);
});

test('circle route helpers return scoped paths and params for each sub-flow', () => {
  const routes = loadRoutes();

  assert.deepEqual(normalize(routes.getCircleDetailHref('messages', 'circle-1')), {
    pathname: '/(tabs)/messages/circle/[id]',
    params: { id: 'circle-1' },
  });
  assert.deepEqual(normalize(routes.getCircleEditHref('discover', 'circle-1')), {
    pathname: '/(tabs)/discover/circle/[id]/edit',
    params: { id: 'circle-1' },
  });
  assert.deepEqual(
    normalize(routes.getCircleInviteHref('messages', 'circle-1', 'Circle', 'avatar')),
    {
      pathname: '/(tabs)/messages/circle/[id]/invite',
      params: { id: 'circle-1', title: 'Circle', avatar: 'avatar' },
    },
  );
  assert.deepEqual(
    normalize(routes.getCircleShareHref('discover', 'circle-1', 'Circle', 'avatar')),
    {
      pathname: '/(tabs)/discover/circle/[id]/share',
      params: { id: 'circle-1', title: 'Circle', avatar: 'avatar' },
    },
  );
  assert.deepEqual(
    normalize(routes.getCircleInviteFriendsHref('messages', 'circle-1', 'Circle')),
    {
      pathname: '/(tabs)/messages/circle/[id]/invite-friends',
      params: { id: 'circle-1', title: 'Circle' },
    },
  );
  assert.deepEqual(normalize(routes.getInvitationDetailHref('discover', 'invite-1')), {
    pathname: '/(tabs)/discover/invitation/[id]',
    params: { id: 'invite-1' },
  });
  assert.deepEqual(normalize(routes.getVerificationDetailHref('messages', 'invite-1')), {
    pathname: '/(tabs)/messages/verification/[id]',
    params: { id: 'invite-1' },
  });
});
