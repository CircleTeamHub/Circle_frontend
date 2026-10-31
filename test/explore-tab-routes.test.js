const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

function loadRoutes() {
  const filePath = path.join(root, 'src/features/user/utils/routes.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, require };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name) ? [rel] : [];
  });
}

test('every literal tab route in the app resolves to a route file', () => {
  // 改版把朋友圈迁进探索栈、圈子 tab 沿用 discover 目录;任何写死的
  // '/(tabs)/<tab>/...' 指向不存在的文件,就是一条点了白屏的死链。
  const literal = /['"]\/\(tabs\)\/([a-z-]+)((?:\/[\w\-[\]]+)*)['"]/g;
  const missing = [];
  for (const rel of [...walk('src'), ...walk('app')]) {
    for (const match of read(rel).matchAll(literal)) {
      const base = `app/(tabs)/${match[1]}${match[2]}`;
      if (!exists(`${base}.tsx`) && !exists(`${base}/index.tsx`)) {
        missing.push(`${rel}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('the explore stack resolves its own scope and keeps moments inside it', () => {
  const routes = loadRoutes();
  const normalize = (href) => JSON.parse(JSON.stringify(href));

  assert.equal(routes.getUserProfileScopeFromSegments(['(tabs)', 'explore', 'moment', '[id]']), 'explore');
  assert.deepEqual(normalize(routes.getUserProfileHref('explore', 'u1')), {
    pathname: '/(tabs)/explore/user/[id]',
    params: { id: 'u1' },
  });
  assert.deepEqual(normalize(routes.getMomentDetailHref('explore', 'm1', 'c1')), {
    pathname: '/(tabs)/explore/moment/[id]',
    params: { id: 'm1', targetCommentId: 'c1' },
  });
  // 其余栈没有朋友圈详情镜像,仍落到圈子栈那份(改版前的行为)。
  for (const scope of ['discover', 'contacts', 'profile', 'messages']) {
    assert.equal(routes.getMomentDetailHref(scope, 'm1').pathname, '/(tabs)/discover/moment/[id]');
  }
  assert.equal(routes.getTabHomeHref('explore'), '/(tabs)/explore');

  for (const rel of [
    'src/features/discover/components/moments-feed.tsx',
    'src/features/discover/screens/UserMomentsScreen.tsx',
  ]) {
    assert.match(read(rel), /getMomentDetailHref\(scope, postId\)/, rel);
  }
  assert.match(read('src/features/discover/components/moment-card.tsx'), /getUserProfileHref\(scope, post\.author\.id\)/);
  assert.match(read('src/features/discover/screens/MomentDetailScreen.tsx'), /getUserProfileHref\(scope, post\.author\.id\)/);
});

test('the assistant opened from explore hands off to a chat in the same stack', () => {
  assert.match(read('app/(tabs)/explore/assistant.tsx'), /AssistantChatScreen/);
  const screen = read('src/features/assistant/screens/AssistantChatScreen.tsx');
  assert.match(screen, /getChatDetailHref\(\s*scope,/);
  assert.doesNotMatch(screen, /pathname: '\/\(tabs\)\/messages\/chat-detail'/);
});

test('group invites opened from explore chat info stay in the explore stack', () => {
  assert.ok(exists('app/(tabs)/explore/invite-group-members.tsx'));
  assert.ok(exists('app/(tabs)/explore/circle/[id]/invite-friends.tsx'));
  const src = read('src/features/chat/screens/ChatInfoScreen.tsx');
  const handler =
    src.match(/const handleOpenInviteGroupMembers = useCallback\([\s\S]*?\n  \}, \[/)?.[0] ?? '';
  assert.match(handler, /scope === 'explore'\) pathname = '\/\(tabs\)\/explore\/invite-group-members'/);
  assert.match(handler, /'\/\(tabs\)\/explore\/circle\/\[id\]\/invite-friends'/);
});

test('explore home is two tiles with names only: moments first, then the assistant', () => {
  const screen = read('src/features/explore/screens/ExploreScreen.tsx');
  const cards = [...screen.matchAll(/<ExploreTile\n[\s\S]*?\n {10}\/>/g)].map((match) => match[0]);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /E2E_TEST_IDS\.exploreMomentsEntry/);
  assert.match(cards[0], /onPress=\{handleOpenMoments\}/);
  assert.match(cards[1], /E2E_TEST_IDS\.exploreAssistantEntry/);
  assert.match(cards[1], /onPress=\{handleOpenAssistant\}/);
  // 贴纸插画：朋友圈是拍立得，AI小助手是小助手气泡本尊。
  assert.match(cards[0], /art=\{<MomentsTileArt /);
  assert.match(cards[1], /art=\{<AssistantTileArt \/>\}/);
  assert.match(read('src/features/explore/components/explore-tile-art.tsx'), /CHAT_BUBBLE_PATHS\[layer\]/);
  assert.match(read('app/(tabs)/explore/moments.tsx'), /MomentsScreen/);
  // 用户要求卡片只保留名字，不再有说明文字。
  assert.doesNotMatch(screen, /hint=|Hint'/);
  assert.match(read('src/theme/tokens.ts'), /exploreMoments: \[/);
  assert.match(read('src/theme/tokens.ts'), /exploreAssistant: \[/);
});

test('legacy discover moment routes keep resolving after the move', () => {
  for (const rel of [
    'app/(tabs)/discover/moments.tsx',
    'app/(tabs)/discover/moment/[id].tsx',
    'app/(tabs)/discover/create-moment.tsx',
    'app/(tabs)/discover/user/[id]/moments.tsx',
    'app/(tabs)/contacts/moments.tsx',
  ]) {
    assert.ok(exists(rel), `${rel} removed — 老链接会断`);
  }
});

test('explore tab labels exist in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    for (const key of ['circles', 'explore']) {
      assert.ok(messages.tabs[key], `${locale} tabs.${key}`);
    }
    assert.ok(messages.explore.title, `${locale} explore.title`);
    assert.equal(messages.tabs.discover, undefined, `${locale} stale tabs.discover`);
  }
});
