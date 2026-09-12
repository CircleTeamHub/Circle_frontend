const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 隐私页补的三项:显示在线时间 / 单聊输入状态 / 群聊输入状态。
// 这组断言钉住三件事:客户端接线完整(开关真的 PATCH 服务端、门禁真的在发送侧、
// 对方隐藏时界面真的不画)、五语种词条齐全、以及与后端的跨仓契约(字段名、
// 列默认值、迁移、presence 协议的 detail / lastSeenAt / hidden)。
const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];
const flatten = (obj, prefix = '') =>
  Object.entries(obj).reduce((out, [key, value]) => {
    const p = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, p));
    } else {
      out[p] = value;
    }
    return out;
  }, {});
const locale = (lng) => flatten(JSON.parse(read(`src/i18n/locales/${lng}.json`)));

const FIELDS = ['shareOnlineStatus', 'shareTypingInDirect', 'shareTypingInGroup'];
const ROW_LABELS = {
  shareOnlineStatus: 'onlineTime',
  shareTypingInDirect: 'singleTyping',
  shareTypingInGroup: 'groupTyping',
};

test('the privacy API declares the three switches as optional (old backends omit them)', () => {
  const api = read('src/services/api/privacy.ts');
  for (const field of FIELDS) {
    assert.match(api, new RegExp(`^  ${field}\\?: boolean;`, 'm'), field);
  }
});

test('the privacy screen binds each switch to its server field and mirrors the backend default', () => {
  const screen = read('src/features/profile/screens/PrivacySettingsScreen.tsx');
  const defaults = screen.slice(
    screen.indexOf('const DEFAULT_PRIVACY_SETTINGS'),
    screen.indexOf('export default function PrivacySettingsScreen'),
  );
  for (const field of FIELDS) {
    // 读当前值(旧服务端缺省 true)+ 写回服务端 + 默认值与后端一致。
    assert.match(screen, new RegExp(`value: currentSettings\\.${field} \\?\\? true`), field);
    assert.match(screen, new RegExp(`patchSettings\\(\\{ ${field}: value \\}\\)`), field);
    assert.match(defaults, new RegExp(`${field}: true`), field);
    assert.match(screen, new RegExp(`settingsDetails\\.privacy\\.${ROW_LABELS[field]}'`));
  }
  // 三项都不再走本地 useAppSettingsStore 的摆设开关。
  assert.doesNotMatch(screen, /setSetting\(/);
  const appSettings = read('src/features/profile/store/use-app-settings-store.ts');
  for (const legacy of ['onlineTime', 'singleTyping', 'groupTyping']) {
    assert.doesNotMatch(appSettings, new RegExp(`^  ${legacy}:`, 'm'), `${legacy} placeholder still in app settings`);
  }
});

test('the typing gate lives in socket-manager; the screen only passes the chat kind', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  const gate = manager.slice(manager.indexOf('export function sendChatTyping'));
  assert.match(gate, /useChatStore\.getState\(\)\.viewerTypingPolicy/);
  assert.match(gate, /kind === 'group' \? !policy\.group : !policy\.direct/);

  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /sendChatTyping\(conversationID, isGroupChat \? 'group' : 'direct'\)/);
  assert.doesNotMatch(screen, /settings\.singleTyping|settings\.groupTyping/);

  // 隐私页保存后立刻同步进 chat store;连接时先用按账号缓存,服务端刷新后覆盖。
  const privacyScreen = read('src/features/profile/screens/PrivacySettingsScreen.tsx');
  assert.equal(
    (privacyScreen.match(/setViewerTypingPolicy\(viewerTypingPolicyFromPrivacy\(/g) ?? []).length,
    2,
    'load + save 各同步一次',
  );
  assert.match(manager, /store\.setViewerTypingPolicy\(readViewerTypingPolicy\(userId\)\)/);
  assert.match(manager, /store\.setViewerTypingPolicy\(viewerTypingPolicyFromPrivacy\(settings\)\)/);
});

test('presence protocol: detail query, last-seen + hidden broadcast, header hides unknown peers', () => {
  const manager = read('src/chat-core/socket-manager.ts');
  assert.match(manager, /\{ userIds, detail: true \}/);
  assert.match(manager, /typeof value === 'boolean'/, '旧服务端的 boolean ack 仍要收');

  const dispatcher = read('src/chat-core/dispatcher.ts');
  assert.match(dispatcher, /payload\.hidden === true/);
  assert.match(dispatcher, /store\.clearPresence\(payload\.userId\)/);

  const store = read('src/chat-core/store.ts');
  assert.match(store, /lastSeenByUser: Record<string, string \| null>;/);
  assert.match(store, /clearPresence: \(userId: string\) => void;/);

  const protocol = read('src/chat-core/protocol.ts');
  assert.match(protocol, /lastSeenAt\?: string \| null;/);
  assert.match(protocol, /hidden\?: boolean;/);

  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /usePeerPresence\(peerImId\)/);
  // 对方隐藏 / 未知时整行不画 —— 画「离线」仍是在泄露信息。
  assert.match(screen, /: peerPresence\.known\s*\? peerPresence\.label\s*: ''/);
  assert.match(screen, /\{headerStatusText \? \(/);

  const hook = read('src/chat-core/use-peer-presence.ts');
  assert.match(hook, /describeLastSeen\(lastSeenAt, now\)/);
  assert.match(hook, /setInterval\(\(\) => setNow\(Date\.now\(\)\), LAST_SEEN_TICK_MS\)/);
});

test('last-seen labels exist in all five locales and the switch rows carry no hint', () => {
  for (const lng of LOCALES) {
    const dict = locale(lng);
    assert.ok(dict['chat.detail.lastSeenJustNow'], `${lng}: lastSeenJustNow`);
    for (const unit of ['Minutes', 'Hours', 'Days']) {
      // 无后缀基键是必须的:i18next 在同一语言内先试带后缀的键,missing 才试基键,
      // 之后才跨语言回落。只写 _other 的话 zh 被问到 _one 会直接掉进 en ——
      // 中文界面上出现英文,而且没有任何报错。仓库里每个计数键都是这么写的。
      const base = dict[`chat.detail.lastSeen${unit}`];
      assert.ok(base, `${lng}: lastSeen${unit} base key (plural fallback)`);
      assert.match(base, /\{\{count\}\}/, `${lng}: lastSeen${unit} needs count`);
      const other = dict[`chat.detail.lastSeen${unit}_other`];
      assert.ok(other, `${lng}: lastSeen${unit}_other`);
      assert.match(other, /\{\{count\}\}/, `${lng}: lastSeen${unit}_other needs count`);
      if (lng === 'en' || lng === 'es') {
        const one = dict[`chat.detail.lastSeen${unit}_one`];
        assert.ok(one, `${lng}: lastSeen${unit}_one`);
        assert.match(one, /\{\{count\}\}/);
      }
    }
    // 三行开关只留标题,不带说明文字(用户拍板)。
    for (const label of ['onlineTime', 'singleTyping', 'groupTyping']) {
      assert.ok(dict[`settingsDetails.privacy.${label}`]?.trim(), `${lng}: ${label}`);
      assert.equal(
        dict[`settingsDetails.privacy.${label}Hint`],
        undefined,
        `${lng}: ${label}Hint should be gone`,
      );
    }
  }
});

// —— 跨仓:后端并排检出时逐项比对,只跑前端 CI 时跳过。 ——
// CIRCLE_BE_PATH 覆盖是给 git worktree 用的:worktree 旁边那个 circle_be 往往是
// 另一条分支。
const bePath = process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
const beDto = path.join(bePath, 'src/privacy/privacy-settings.dto.ts');

test('backend mirrors the fields, column defaults, migration and presence protocol', { skip: !fs.existsSync(beDto) }, () => {
  const beRead = (rel) => fs.readFileSync(path.join(bePath, rel), 'utf8');
  const dto = beRead('src/privacy/privacy-settings.dto.ts');
  const schema = beRead('prisma/schema.prisma');
  const service = beRead('src/privacy/privacy-settings.service.ts');
  for (const field of FIELDS) {
    assert.match(dto, new RegExp(`^  ${field}: boolean;`, 'm'), `dto ${field}`);
    assert.match(dto, new RegExp(`^  ${field}\\?: boolean;`, 'm'), `update dto ${field}`);
    assert.match(schema, new RegExp(`^  ${field}\\s+Boolean\\s+@default\\(true\\)`, 'm'), `schema ${field}`);
    assert.match(service, new RegExp(`^  ${field}: true,`, 'm'), `service default ${field}`);
  }
  const migration = path.join(
    bePath,
    'prisma/migrations/20260911150000_add_presence_and_typing_privacy/migration.sql',
  );
  assert.ok(fs.existsSync(migration), 'migration present');
  const sql = fs.readFileSync(migration, 'utf8');
  for (const field of FIELDS) {
    assert.match(sql, new RegExp(`"${field}" BOOLEAN NOT NULL DEFAULT true`), `migration ${field}`);
  }
  const types = beRead('src/chat/chat.types.ts');
  assert.match(types, /detail\?: boolean;/);
  assert.match(types, /lastSeenAt\?: string \| null;/);
  assert.match(types, /hidden\?: boolean;/);
  // 查询侧与广播侧是同一条规则的两半。
  assert.match(beRead('src/chat/chat.service.ts'), /shareOnlineStatus !== false/);
  assert.match(beRead('src/chat/chat.gateway.ts'), /isPresenceVisible\(userId\)/);
});
