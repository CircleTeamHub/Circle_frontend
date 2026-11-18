// 从哪个 tab 栈点进来,就在哪个栈里打开,返回回到来处。
// 跨栈 push 的页面压在别的 tab 上:那个 tab 打开过时,返回会落到它的首页(比如圈子动态),
// 而不是来时的页面。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = process.cwd();
const TABS = ['messages', 'contacts', 'discover', 'explore', 'profile'];
const EXT = ['.tsx', '.ts', '.native.tsx', '.native.ts', '.ios.tsx', '.ios.ts'];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name) ? [full] : [];
  });
}

function resolveImport(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(root, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  const candidates = [base, ...EXT.map((ext) => base + ext), ...EXT.map((ext) => path.join(base, `index${ext}`))];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;
}

const importCache = new Map();
function importsOf(file) {
  if (!importCache.has(file)) {
    const source = fs.readFileSync(file, 'utf8');
    const specs = [...source.matchAll(/(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)];
    importCache.set(file, specs.map((m) => resolveImport(file, m[1] || m[2])).filter(Boolean));
  }
  return importCache.get(file);
}

/** 每个源文件会被渲染进哪些 tab 栈:从 app/(tabs)/<tab>/ 下的路由文件顺着 import 走。 */
function tabsRenderingEachFile() {
  const reach = new Map();
  for (const tab of TABS) {
    const seen = new Set(walk(path.join(root, 'app/(tabs)', tab)));
    const queue = [...seen];
    while (queue.length) {
      const file = queue.pop();
      if (!reach.has(file)) reach.set(file, new Set());
      reach.get(file).add(tab);
      for (const next of importsOf(file)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }
  return reach;
}

// 有意切 tab 的跳转:进到一个 tab 的首页(没有「返回」可言),或者会话已经没了。
// 按 scope 分派路由的 helper 文件:每个分支只在对应 scope 下走到,由 helper 测试逐 scope 核对。
const SCOPE_DISPATCH_FILES = new Set(['src/features/user/utils/routes.ts', 'src/features/groups/routes.ts']);

const INTENTIONAL_TAB_SWITCH = new Set([
  // 转发给多个会话后「查看」回消息列表,它们都排在最上面。
  'src/features/chat/components/chat-target-picker/announce-sent.ts /(tabs)/messages',
  // 退群 / 解散 / 删好友后会话已经不存在,回消息列表。
  'src/features/chat/screens/ChatInfoScreen.tsx /(tabs)/messages',
  // 登出 / 切账号后回消息页。
  'src/hooks/use-auth.ts /(tabs)/messages',
  // 解析扫到的应用内链接字符串,不是跳转。
  'src/features/messages/utils/scan-result.ts /(tabs)/messages/',
  // 扫到「分组管理」的链接:那一页只在消息栈(通讯录的 groups 是「我的群聊」,另一个页面)。
  'src/features/messages/utils/scan-result.ts /(tabs)/messages/groups',
  // 只有「我的」栈会用到的兜底(scope === 'profile' 分支)。
  'src/features/profile/screens/GroupExpansionScreen.tsx /(tabs)/profile/mall',
  'src/features/profile/screens/SystemAnnouncementDetailScreen.tsx /(tabs)/profile/system-announcements',
  // 自己的资料页「编辑资料」进「我的」里的设置(设置整棵树只在「我的」栈)。
  'src/features/user/screens/UserProfileScreen.tsx /(tabs)/profile/settings',
  // 卡顿探针给页面起名用的路径,不是跳转。
  'src/observability/screen-probe.tsx /(tabs)/explore/index',
  'src/observability/screen-probe.tsx /(tabs)/explore',
]);

test('pages never hard-code a route into a tab stack they are not rendered in', () => {
  const offenders = [];
  for (const [file, tabs] of tabsRenderingEachFile()) {
    const rel = path.relative(root, file);
    if (SCOPE_DISPATCH_FILES.has(rel)) continue; // 按 scope 分派,由下面的 helper 测试守
    const literals = [...fs.readFileSync(file, 'utf8').matchAll(/['"`](\/\(tabs\)\/(messages|contacts|discover|explore|profile)(?:\/[^'"`$]*)?)['"`]/g)];
    const named = new Set(literals.map((m) => m[2]));
    // 文件被渲染进某个栈、却从没写过这个栈的路由:那它写死的路由在这个栈里全是跨栈跳转。
    const someTabUnnamed = [...tabs].some((tab) => !named.has(tab));
    for (const [, literal, tab] of literals) {
      // 另外,指向一个根本不渲染这个文件的栈,本身就是跨栈(写过本栈的兜底也不能放过它)。
      const crossesStack = someTabUnnamed || !tabs.has(tab);
      if (crossesStack && !INTENTIONAL_TAB_SWITCH.has(`${rel} ${literal}`)) {
        offenders.push(`${rel} [${[...tabs].join(',')}] → ${literal}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('every `/(tabs)/${scope}/page` built in a page exists in each stack that renders it', () => {
  const missing = [];
  for (const [file, tabs] of tabsRenderingEachFile()) {
    const rel = path.relative(root, file);
    if (SCOPE_DISPATCH_FILES.has(rel)) continue;
    for (const [, page] of fs.readFileSync(file, 'utf8').matchAll(/`\/\(tabs\)\/\$\{[^}]+\}\/([^`$?]+)`/g)) {
      for (const tab of tabs) {
        const base = path.join(root, 'app/(tabs)', tab, page);
        if (!fs.existsSync(`${base}.tsx`) && !fs.existsSync(path.join(base, 'index.tsx'))) {
          missing.push(`${rel} → /(tabs)/${tab}/${page}`);
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

function loadModule(rel) {
  const file = path.join(root, rel);
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { module: { exports: {} }, require };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context, { filename: file });
  return { source, exports: context.module.exports };
}

/** 导出函数里 `scope: UserProfileScope` 是第几个参数(不一定是第一个)。 */
function scopeTakingHelpers(source) {
  const helpers = [];
  for (const match of source.matchAll(/export function (\w+)\(/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0) {
      if ('([{<'.includes(source[i])) depth += 1;
      if (')]}>'.includes(source[i]) && source[i - 1] !== '=') depth -= 1;
      i += 1;
    }
    const params = [];
    let current = '';
    let level = 0;
    for (const ch of source.slice(start, i - 1)) {
      if ('([{<'.includes(ch)) level += 1;
      if (')]}>'.includes(ch)) level -= 1;
      if (ch === ',' && level === 0) {
        params.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    params.push(current.trim());
    const index = params.findIndex((param) => /^scope\??: UserProfileScope\b/.test(param));
    if (index >= 0) helpers.push({ name: match[1], index });
  }
  return helpers;
}

test('every scope-taking route helper resolves inside the caller stack, to a page that exists there', () => {
  const modules = ['src/features/user/utils/routes.ts', 'src/features/groups/routes.ts'].map(loadModule);
  const helpers = modules.flatMap(({ source, exports }) =>
    scopeTakingHelpers(source).map((helper) => ({ ...helper, fn: exports[helper.name] })));
  assert.ok(helpers.length > 30, `only found ${helpers.length} helpers`);
  for (const name of ['getFriendActivityDetailHref', 'getGroupEntryHref']) {
    assert.ok(helpers.some((helper) => helper.name === name), `${name} not checked`);
  }
  const wrong = [];
  for (const { name, index, fn } of helpers) {
    for (const scope of TABS) {
      const args = ['id-1', 'id-2', 'id-3', 'id-4'];
      args.splice(index, 0, scope);
      const href = fn(...args);
      const pathname = typeof href === 'string' ? href.split('?')[0] : href.pathname;
      const home = `/(tabs)/${scope}`;
      if (pathname !== home && !pathname.startsWith(`${home}/`)) {
        wrong.push(`${name}(${scope}) → ${pathname}`);
        continue;
      }
      const page = path.join(root, 'app', pathname);
      if (pathname !== home && !fs.existsSync(`${page}.tsx`) && !fs.existsSync(path.join(page, 'index.tsx'))) {
        wrong.push(`${name}(${scope}) → ${pathname} (no route file)`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});
