const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 群管理(设管理员/移出/逐人禁言)+ 群日志(独立于聊天记录的事件账本)。
// 这组断言钉住三件事:客户端接线完整(端点/路由四栈/管理入口)、每种事件与
// 每个新错误码都有五语种文案、以及与后端的跨仓契约(端点、错误码、事件种类)。
const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];
const locale = (lng) => JSON.parse(read(`src/i18n/locales/${lng}.json`));

const EVENT_KINDS = [
  'group-created',
  'member-joined',
  'member-left',
  'member-removed',
  'member-role-changed',
  'member-silenced',
  'member-unsilenced',
  'owner-transferred',
  'group-renamed',
  'group-notice-updated',
  'group-avatar-updated',
  'mute-all-changed',
  'policy-changed',
  'history-cleared',
];

const NEW_ERROR_CODES = [
  'CHAT_GROUP_OWNER_ONLY',
  'CHAT_GROUP_MANAGER_ONLY',
  'CHAT_GROUP_MEMBER_NOT_FOUND',
  'CHAT_GROUP_TARGET_PROTECTED',
  'CHAT_GROUP_SELF_TARGET',
  'CHAT_MEMBER_SILENCED',
  'CHAT_SILENCE_DURATION_INVALID',
];

test('chat-core exposes the group admin and event endpoints', () => {
  const api = read('src/chat-core/api.ts');
  assert.match(api, /export function fetchChatGroupEvents\(/);
  assert.match(api, /\/chat\/conversations\/\$\{conversationId\}\/events/);
  assert.match(api, /export function setGroupChatMemberRole\(/);
  assert.match(api, /members\/\$\{userId\}\/role`,\s*\{ method: 'PATCH'/);
  assert.match(api, /export function removeGroupChatMember\(/);
  assert.match(api, /members\/\$\{userId\}`,\s*\{ method: 'DELETE' \}/);
  assert.match(api, /export function silenceChatMember\(/);
  assert.match(api, /members\/\$\{userId\}\/silence`,\s*\{ method: 'PUT', body: \{ durationSec \} \}/);
  assert.match(api, /export function unsilenceChatMember\(/);
  assert.match(api, /members\/\$\{userId\}\/silence`,\s*\{ method: 'DELETE' \}/);

  const protocol = read('src/chat-core/protocol.ts');
  assert.match(protocol, /export interface ChatGroupEventDto/);
  assert.match(protocol, /export interface ChatGroupEventsPageDto/);
  assert.match(protocol, /export interface ChatMemberSilenceDto/);
  // 老后端不返这两个字段:必须可选,否则老服务端上会话列表整体失效。
  assert.match(protocol, /silenced\?: boolean;/);
  assert.match(protocol, /silencedUntil\?: string \| null;/);
  for (const kind of EVENT_KINDS) {
    assert.match(protocol, new RegExp(`\\| '${kind}'`), `protocol lacks kind ${kind}`);
  }
});

test('new backend error codes are mirrored and the silence rejection is expected on send', () => {
  const codes = read('src/services/api/server-error-codes.ts');
  for (const code of NEW_ERROR_CODES) {
    assert.match(codes, new RegExp(`'${code}'`), `server-error-codes lacks ${code}`);
  }
  // 被禁言是产品预期内的拒绝:用户看具体原因,不进 Sentry。
  assert.match(read('src/chat-core/send-errors.ts'), /'CHAT_MEMBER_SILENCED'/);
  for (const lng of LOCALES) {
    const errors = locale(lng).serverErrors;
    for (const code of NEW_ERROR_CODES) {
      assert.equal(
        typeof errors[code] === 'string' && errors[code].trim().length > 0,
        true,
        `${lng}.json serverErrors lacks ${code}`,
      );
    }
  }
});

test('system notices cover silence and owner transfer without rendering blank rows', () => {
  const mapper = read('src/chat-core/message-mappers.ts');
  for (const kind of ['member-silenced', 'member-unsilenced', 'owner-transferred']) {
    assert.match(mapper, new RegExp(`case '${kind}'`), `systemNoticeText lacks ${kind}`);
  }
  assert.match(mapper, /export function formatSilenceDuration\(/);
  for (const lng of LOCALES) {
    const im = locale(lng).im;
    for (const key of [
      'memberSilenced',
      'memberSilencedIndefinitely',
      'memberUnsilenced',
      'ownerTransferred',
      'ownerTransferredUnnamed',
    ]) {
      assert.equal(typeof im.notification[key], 'string', `${lng}.json lacks im.notification.${key}`);
    }
    for (const key of ['minutes', 'hours', 'days', 'indefinite']) {
      assert.equal(typeof im.silence[key], 'string', `${lng}.json lacks im.silence.${key}`);
    }
  }
});

// group-events.ts 只依赖 i18n 与 message-mappers 的一个纯函数,用 vm 装载真实实现。
function loadGroupEventText(translate) {
  const filePath = path.join(root, 'src/chat-core/group-events.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require(request) {
      if (request === '@/i18n') return { __esModule: true, default: { t: translate } };
      if (request === './message-mappers') {
        return {
          formatSilenceDuration: (seconds) => `${seconds}s`,
          groupPolicyLabel: (policy) => `policy:${policy}`,
        };
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports.groupEventText;
}

test('every event kind renders a named sentence; unknown kinds fall back, never blank', () => {
  const calls = [];
  const groupEventText = loadGroupEventText((key, values) => {
    calls.push([key, values]);
    return key;
  });
  const actor = { id: 'a', nickname: 'Alice', avatarUrl: null };
  const targets = [{ id: 'b', nickname: 'Bob', avatarUrl: null }];
  for (const kind of EVENT_KINDS) {
    const text = groupEventText({
      id: `e-${kind}`,
      kind,
      actor,
      targets,
      payload: { role: 'ADMIN', durationSec: 600, name: '周末爬山' },
      createdAt: '2026-09-08T00:00:00.000Z',
    });
    assert.match(text, /^chat\.groupEvent\./, `${kind} does not use the chat.groupEvent vocabulary`);
  }
  // 点名:操作者与目标昵称必须进入插值,而不是只有一句被动句。
  // (插值对象产自 vm 的另一个 realm,展开成宿主对象再做严格深比较。)
  const removed = calls.find(([key]) => key === 'chat.groupEvent.memberRemoved');
  assert.deepEqual({ ...removed[1] }, { actor: 'Alice', targets: 'Bob' });
  const silenced = calls.find(([key]) => key === 'chat.groupEvent.memberSilenced');
  assert.deepEqual({ ...silenced[1] }, { actor: 'Alice', targets: 'Bob', duration: '600s' });

  // 圈子对账入座没有操作者;扫码进群带 via;已注销账号昵称为空串。
  assert.equal(
    groupEventText({ id: 'x', kind: 'member-joined', actor: null, targets, payload: null, createdAt: '' }),
    'chat.groupEvent.memberJoinedPlain',
  );
  assert.equal(
    groupEventText({ id: 'y', kind: 'member-joined', actor, targets, payload: { via: 'qr' }, createdAt: '' }),
    'chat.groupEvent.memberJoinedQr',
  );
  const ghostCall = [];
  const ghostText = loadGroupEventText((key, values) => {
    ghostCall.push([key, values]);
    return key;
  });
  ghostText({
    id: 'z',
    kind: 'member-left',
    actor: null,
    targets: [{ id: 'gone', nickname: '', avatarUrl: null }],
    payload: null,
    createdAt: '',
  });
  const left = ghostCall.find(([key]) => key === 'chat.groupEvent.memberLeft');
  assert.deepEqual({ ...left[1] }, { targets: 'chat.groupEvent.unknownMember' });

  assert.equal(
    groupEventText({ id: 'u', kind: 'something-new', actor, targets, payload: null, createdAt: '' }),
    'chat.groupActivity',
  );
});

test('the five locales define copy for every event kind and the management screen', () => {
  const eventKeys = [
    'system', 'unknownMember', 'nameSeparator',
    'groupCreated', 'groupCreatedPlain',
    'memberJoined', 'memberJoinedQr', 'memberJoinedPlain',
    'memberLeft', 'memberRemoved', 'memberPromoted', 'memberDemoted',
    'memberSilenced', 'memberSilencedIndefinitely', 'memberUnsilenced',
    'ownerTransferred', 'groupRenamed', 'groupNoticeUpdated', 'historyCleared',
    'muteAllEnabled', 'muteAllDisabled', 'groupAvatarUpdated',
    'policyEnabled', 'policyDisabled',
  ];
  const manageKeys = [
    'admins', 'adminsHint', 'addAdmin', 'noAdmins', 'removeAdmin',
    'silencedMembers', 'noSilenced', 'addSilence', 'lift',
    'removeMembers', 'removeMembersHint', 'pickMember', 'noCandidates',
    'searchPlaceholder', 'loadFailed', 'restricted',
  ];
  for (const lng of LOCALES) {
    const chat = locale(lng).chat;
    for (const key of eventKeys) {
      assert.equal(typeof chat.groupEvent[key], 'string', `${lng}.json lacks chat.groupEvent.${key}`);
    }
    for (const key of manageKeys) {
      assert.equal(typeof chat.groupManagement[key], 'string', `${lng}.json lacks chat.groupManagement.${key}`);
    }
    for (const key of [
      'groupManage', 'silenced', 'silenceMember', 'unsilenceMember', 'silencePickDuration',
      'memberSilenced', 'memberUnsilenced', 'silencedUntil', 'silencedIndefinitely',
      'youAreSilenced', 'youAreSilencedUntil', 'youAreSilencedIndefinitely',
    ]) {
      assert.equal(typeof chat[key], 'string', `${lng}.json lacks chat.${key}`);
    }
  }
});

test('group log reads the event ledger and the management screen is reachable from every tab stack', () => {
  const logScreen = read('src/features/chat/screens/GroupLogScreen.tsx');
  assert.match(logScreen, /fetchChatGroupEvents\(conversationID/);
  assert.match(logScreen, /groupEventText\(item\)/);
  assert.doesNotMatch(logScreen, /searchChatMessages/);
  // 服务端游标不前进就停,别在同一页上无限触底。
  assert.match(logScreen, /page\.nextCursor === cursor/);

  const manageScreen = read('src/features/chat/screens/GroupManageScreen.tsx');
  assert.match(manageScreen, /useGroupAdminActions\(/);
  assert.match(manageScreen, /GroupMemberPickerSheet/);
  assert.match(manageScreen, /SILENCE_DURATION_OPTIONS/);
  // 群主专属段(设管理员)与群主/管理员共享段(禁言/移出)分开门控。
  assert.match(manageScreen, /\{isOwner \? \(/);
  assert.match(manageScreen, /if \(!canManage\)/);

  for (const tab of ['messages', 'contacts', 'discover', 'profile']) {
    const route = read(`app/(tabs)/${tab}/group-manage.tsx`);
    assert.match(route, /GroupManageScreen/);
  }
  const routes = read('src/features/user/utils/routes.ts');
  assert.match(routes, /export function getGroupManageHref\(/);
  for (const tab of ['messages', 'contacts', 'discover', 'profile']) {
    assert.match(routes, new RegExp(`'/\\(tabs\\)/${tab}/group-manage'`));
  }
  assert.match(read('src/observability/route-segments.ts'), /'group-manage'/);
});

test('chat info wires standalone-group roles, the management entry and the long-press actions', () => {
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  // 独立群聊的本人角色来自成员目录(服务端派生),不再永远是普通成员。
  assert.match(info, /resolveStandaloneSelfRole\(/);
  assert.match(info, /useGroupAdminActions\(/);
  assert.match(info, /getGroupManageHref\(/);
  assert.match(info, /chat\.groupManage/);
  // 头像长按:设/撤管理员、禁言/解除、移出,统一由 hook 的权限矩阵决定。
  assert.match(info, /groupAdmin\.canChangeRole\(member\)/);
  assert.match(info, /groupAdmin\.canSilence\(member\)/);
  assert.match(info, /groupAdmin\.canKick\(member\)/);
  // 旧的圈子专用踢人/改角色直连调用已收进 hook,不再各自散落。
  assert.doesNotMatch(info, /removeGroupMember\(groupID/);
  assert.doesNotMatch(info, /updateGroupMemberRole\(groupID/);
});

test('chat detail locks the composer while the viewer is silenced', () => {
  const detail = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(detail, /const selfSilenced = useMemo\(/);
  assert.match(detail, /editable=\{!isPreviewMode && !composerLocked\}/);
  assert.match(detail, /disabled=\{sending \|\| isPreviewMode \|\| isVoiceRecording \|\| composerLocked\}/);
  assert.match(detail, /testID="chat-silenced-bar"/);
  assert.match(detail, /chat\.youAreSilencedUntil/);
  assert.match(detail, /const timer = setTimeout\(\(\) => setSilenceClock\(Date\.now\(\)\), remaining \+ 1\)/);
});

test('silence labels follow language changes and timed silence expiry refreshes management UI', () => {
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  const manage = read('src/features/chat/screens/GroupManageScreen.tsx');
  assert.match(info, /const silenceOptions = SILENCE_DURATION_OPTIONS\.map\(\(seconds\) => \(\{/);
  assert.match(manage, /const silenceOptions = SILENCE_DURATION_OPTIONS\.map\(\(seconds\) => \(\{/);
  assert.match(manage, /const \[silenceClock, setSilenceClock\] = useState\(\(\) => Date\.now\(\)\);/);
  assert.match(manage, /isSilencedMember\(member, silenceClock\)/);
});

// ── 跨仓契约:双仓并排检出时逐项对齐;仅前端 CI 时跳过 ──
const BACKEND_ROOT = path.join(root, '..', 'circle_be');
const hasBackend = fs.existsSync(path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'));

test(
  'backend exposes the group admin and event endpoints the client calls',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const controller = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/chat/chat.controller.ts'),
      'utf8',
    );
    assert.match(controller, /@Get\('conversations\/:id\/events'\)/);
    assert.match(controller, /@Patch\('conversations\/:id\/members\/:userId\/role'\)/);
    assert.match(controller, /@Delete\('conversations\/:id\/members\/:userId'\)/);
    assert.match(controller, /@Put\('conversations\/:id\/members\/:userId\/silence'\)/);
    assert.match(controller, /@Delete\('conversations\/:id\/members\/:userId\/silence'\)/);
  },
);

test(
  'backend error codes and event kinds are mirrored on the client',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const codes = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/common/app-error-codes.ts'),
      'utf8',
    );
    for (const code of NEW_ERROR_CODES) {
      assert.match(codes, new RegExp(`'${code}'`), `backend lacks ${code}`);
    }
    const types = fs.readFileSync(path.join(BACKEND_ROOT, 'src/chat/chat.types.ts'), 'utf8');
    const block = types.match(/export type ChatGroupEventKind =([\s\S]*?);/);
    assert.ok(block, 'backend chat.types.ts has no ChatGroupEventKind');
    const backendKinds = [...block[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...backendKinds].sort(), [...EVENT_KINDS].sort());
    // 每种事件在群日志里都得有文案分支,否则那一行只剩「群聊活动」。
    const formatter = read('src/chat-core/group-events.ts');
    for (const kind of backendKinds) {
      assert.match(formatter, new RegExp(`case '${kind}'`), `groupEventText lacks ${kind}`);
    }
  },
);
