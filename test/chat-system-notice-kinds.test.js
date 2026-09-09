const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 焚毁档位表(burn-durations.ts)只依赖 i18n —— 这里加载**真实实现**而不是桩:
// 档位白名单是 setViewerSelfDestructSec 的唯一闸门,用假的等于没测。
let __burnDurationsSource = null;
function loadBurnDurations(translate = (key) => key) {
  if (!__burnDurationsSource) {
    const filePath = path.join(process.cwd(), 'src/chat-core/burn-durations.ts');
    __burnDurationsSource = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filePath,
    }).outputText;
  }
  const ctx = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === '@/i18n') {
        return { __esModule: true, default: { t: translate, language: 'zh' } };
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  ctx.exports = ctx.module.exports;
  vm.runInNewContext(__burnDurationsSource, ctx);
  return ctx.module.exports;
}

// systemNoticeText 把结构化系统消息映射成一行文案。未知 kind 兜底空串，而空串
// 在时间线上不是「隐藏」——SystemNoticePill 照样占一行内边距，会话照样多一条
// 未读、预览还是空的。所以后端每加一种 kind，这里不加 case 就是一条肉眼可见的
// 空白记录；这个文件就是钉住这件事。
const root = process.cwd();

// message-mappers 只用到 i18n 与两个纯工具，用同款 vm harness 装载，避免把
// 整个 app 依赖图拖进来。
function loadSystemNoticeText(translate) {
  const filePath = path.join(root, 'src/chat-core/message-mappers.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    console,
    require(request) {
      if (request === '@/i18n') {
        return { __esModule: true, default: { t: translate, language: 'zh' } };
      }
      if (request === '@/features/qr/qr-payload') {
        return { normalizeQrToken: (value) => value };
      }
      if (request === '@/services/api/utils') {
        return { allowPeerMediaUrl: (value) => value };
      }
      if (request === './mappers') {
        return { formatChatTimestamp: () => '' };
      }
      if (request === './burn-durations') return loadBurnDurations();
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports.systemNoticeText;
}

// 后端在群管理动作里写入的 kind 与它们的载荷（见 circle_be 的 chat.service.ts /
// group.service.ts / circle.service.ts）。载荷里只有 ID，没有昵称。
const MANAGEMENT_NOTICES = [
  ['history-cleared', { kind: 'history-cleared', actorId: 'u1' }],
  ['member-removed', { kind: 'member-removed', actorId: 'u1', targetUserId: 'u2' }],
  [
    'member-role-changed → ADMIN',
    { kind: 'member-role-changed', actorId: 'u1', targetUserId: 'u2', role: 'ADMIN' },
  ],
  [
    'member-role-changed → MEMBER',
    { kind: 'member-role-changed', actorId: 'u1', targetUserId: 'u2', role: 'MEMBER' },
  ],
  ['group-notice-updated', { kind: 'group-notice-updated', actorId: 'u1' }],
];

test('every group-management notice renders real text, never a blank row', () => {
  const systemNoticeText = loadSystemNoticeText((key) => `t:${key}`);

  for (const [label, content] of MANAGEMENT_NOTICES) {
    const text = systemNoticeText(content);
    assert.notEqual(text, '', `${label} renders as a blank system pill`);
    assert.match(text, /^t:im\.notification\./, `${label} does not use the im.notification vocabulary`);
  }
});

// 授予与撤销必须说的是相反的事。两边都落到同一条文案，等于把「被设为管理员」
// 和「被取消管理员」显示成一句话。
test('promotion and demotion do not collapse into the same sentence', () => {
  const systemNoticeText = loadSystemNoticeText((key) => key);
  const base = { kind: 'member-role-changed', actorId: 'u1', targetUserId: 'u2' };

  const promoted = systemNoticeText({ ...base, role: 'ADMIN' });
  const demoted = systemNoticeText({ ...base, role: 'MEMBER' });

  assert.notEqual(promoted, demoted);
});

// 后端将来多出第三种角色时，宁可说得笼统也不能掉进 default 变成空白。
test('an unfamiliar role still says something', () => {
  const systemNoticeText = loadSystemNoticeText((key) => key);
  const text = systemNoticeText({
    kind: 'member-role-changed',
    actorId: 'u1',
    targetUserId: 'u2',
    role: 'OWNER',
  });

  assert.notEqual(text, '');
});

// 真正没有 kind 的载荷仍然应当隐藏，别把兜底做成「什么都显示」。
test('a payload without a recognizable kind stays hidden', () => {
  const systemNoticeText = loadSystemNoticeText((key) => key);

  assert.equal(systemNoticeText({}), '');
  assert.equal(systemNoticeText({ kind: 'not-a-real-kind' }), '');
});

test('the five locales all define the group-management notice copy', () => {
  const keys = [
    'historyCleared',
    'memberKicked',
    'memberPromoted',
    'memberDemoted',
    'memberRoleChanged',
    'groupNoticeUpdated',
  ];

  for (const lng of ['en', 'zh', 'ja', 'ko', 'es']) {
    const locale = JSON.parse(
      fs.readFileSync(path.join(root, `src/i18n/locales/${lng}.json`), 'utf8'),
    );
    for (const key of keys) {
      const value = locale.im?.notification?.[key];
      assert.equal(
        typeof value === 'string' && value.trim().length > 0,
        true,
        `${lng}.json is missing im.notification.${key}`,
      );
    }
  }
});

// 跨仓契约：后端写进系统消息的每一种 kind，前端都必须有 case。仿
// chat-core-protocol-contract.test.js —— 双仓并排检出时真跑，仅前端 CI 时跳过。
const BACKEND_SOURCES = [
  'src/chat/chat.service.ts',
  'src/chat/chat-group-admin.service.ts',
  'src/group/group.service.ts',
  'src/circle/circle.service.ts',
].map((rel) => path.join(root, '..', 'circle_be', rel));
const hasBackend = BACKEND_SOURCES.every((file) => fs.existsSync(file));

test(
  'every system-message kind the backend writes has a case on the client',
  { skip: !hasBackend && 'circle_be not checked out beside the frontend' },
  () => {
    const mapper = fs.readFileSync(
      path.join(root, 'src/chat-core/message-mappers.ts'),
      'utf8',
    );

    // `kind` 在后端是复用字段：emitConversationChange 也发 { kind: 'joined' |
    // 'left' | 'removed' }，那是 chat:conversation 事件的词汇，与系统消息无关，
    // 本来就不该有文案。所以只取真正落进系统消息 content 的那些 —— 从
    // insertSystemMessage* 调用点往后一个有界窗口里找。
    const emitted = new Set();
    for (const file of BACKEND_SOURCES) {
      const source = fs.readFileSync(file, 'utf8');
      // 两条写入口都扫:事务内的 insertSystemMessage*,以及尽力而为的
      // systemMessage.emit(进群/退群/改名/群主转让走的是它)。
      for (const call of source.matchAll(
        /insertSystemMessage\w*\(|\.systemMessage\s*\.emit\(/g,
      )) {
        const window = source.slice(call.index, call.index + 400);
        const kind = window.match(/\bkind:\s*'([a-z][a-z-]*)'/);
        if (kind) emitted.add(kind[1]);
      }
    }

    assert.ok(emitted.size > 0, 'no system-message kinds found in the backend sources');

    const unmapped = [...emitted].filter(
      (kind) => !mapper.includes(`case '${kind}':`) && !mapper.includes(`case '${kind}': {`),
    );
    assert.deepEqual(
      unmapped,
      [],
      `systemNoticeText has no case for: ${unmapped.join(', ')} — those render as blank system rows`,
    );
  },
);
