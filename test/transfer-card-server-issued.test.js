const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 转账卡片是**服务端签发**的回执,客户端只渲染、不发送。
 *
 * 历史:卡片曾由客户端在扣款成功后自己发。自研聊天栈把 transfer-card 收进后端的
 * SERVER_MESSAGE_TYPES(客户端能发这类型 = 能凭空捏造「钱已划走」这个服务端事实),
 * 但客户端那半边没删 —— 于是每一笔转账的发卡都被 validateSendPayload 拒掉:
 * 付款方吃一个红色失败气泡(还会连同 outbox 一起在每次冷启动复现)、Sentry 收一条
 * CHAT_INVALID_PAYLOAD、收款方要等补偿 cron 的 2 分钟宽限才看得到卡。
 *
 * 现在 CoinService.sendGift 在结算提交后就地签发。本文件钉住三件事:
 * 1. 客户端**不能**再发 transfer-card(连类型都不在可发枚举里);
 * 2. 收到的 transfer-card 照常渲染(删的是发送半边,不是显示半边);
 * 3. 跨仓契约:前端能发的每一种类型都必须在后端 CLIENT_MESSAGE_TYPES 里 ——
 *    这条是这次事故真正的漏网处,前后端各自都「自洽」,只有比对才看得见。
 */
const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// 同 api-error-localization / chat-core-protocol-contract:双仓并排检出时才跑。
// CIRCLE_BE_PATH 覆盖是给 git worktree 用的 —— 在 .claude/worktrees/<name> 里
// `../circle_be` 指不到真正的后端检出,跨仓断言会无声跳过。
const BACKEND_ROOT =
  process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
const BACKEND_CONSTANTS_PATH = path.join(
  BACKEND_ROOT,
  'src/chat/chat.constants.ts',
);
const hasBackend = fs.existsSync(BACKEND_CONSTANTS_PATH);

/** client.ts 里所有实际上行的类型:sendWithOptimism 的 `type: 'x'` + 卡片枚举。 */
function frontendSendableTypes() {
  const client = read('src/chat-core/client.ts');
  const literals = new Set();
  for (const match of client.matchAll(/\btype:\s*'([a-z-]+)'/g)) {
    literals.add(match[1]);
  }
  const union = client.match(/export type ChatCardType =([\s\S]*?);/);
  assert.ok(union, 'client.ts 里找不到 ChatCardType 枚举');
  for (const match of union[1].matchAll(/'([a-z-]+)'/g)) {
    literals.add(match[1]);
  }
  return literals;
}

function backendClientMessageTypes() {
  const backend = fs.readFileSync(BACKEND_CONSTANTS_PATH, 'utf8');
  const block = backend.match(
    /export const CLIENT_MESSAGE_TYPES = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(block, 'circle_be 里找不到 CLIENT_MESSAGE_TYPES');
  return new Set([...block[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
}

test('the client cannot send a transfer card at all', () => {
  const client = read('src/chat-core/client.ts');
  const union = client.match(/export type ChatCardType =([\s\S]*?);/)[1];
  assert.doesNotMatch(
    union,
    /'transfer-card'/,
    'transfer-card 不该出现在客户端可发卡片枚举里 —— 它是服务端签发的回执',
  );
  // 信用分豁免的唯一用途就是这张卡(「钱已经动了」)。卡片不再由客户端发,
  // 这个洞就该一并封掉,而不是留着等下一个调用方顺手打开。
  assert.doesNotMatch(client, /bypassCreditGate/);
});

test('the chat screen has no transfer-card send path left', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.doesNotMatch(screen, /handleSendTransferCard/);
  assert.doesNotMatch(screen, /'transfer-card'[\s\S]{0,200}bypassCreditGate/);
  // 卡片回执的挂账队列随发送路径一起出清。
  assert.doesNotMatch(screen, /enqueueGiftCardAck|flushPendingGiftCardAcks/);
  // 转账成功后不再需要把 payload 传回聊天页补发卡片 —— 卡片自己会从 socket 来。
  assert.doesNotMatch(screen, /consumePendingTransfer/);
});

test('the gift-card ack queue and its endpoint are gone', () => {
  assert.equal(
    exists('src/features/chat/utils/gift-card-ack.ts'),
    false,
    'gift-card-ack.ts 只服务于已删除的客户端发卡路径',
  );
  const api = read('src/services/api/coin.ts');
  assert.doesNotMatch(api, /markGiftCardSent/);
  assert.doesNotMatch(api, /card-sent/);
});

test('receiving and rendering a transfer card still works', () => {
  // 删的是发送半边。收到的卡片仍要落地成 UI 消息并渲染成气泡。
  const mappers = read('src/chat-core/message-mappers.ts');
  assert.match(mappers, /case 'transfer-card':/);
  assert.match(mappers, /sanitizeTransferCard/);
  assert.equal(
    exists('src/features/chat/components/bubbles/transfer-card-bubble.tsx'),
    true,
  );
  const preview = read('src/features/chat/utils/chat-send-payloads.ts');
  assert.match(preview, /case 'transfer-card':/);
});

/**
 * 已知未修的同类缺陷。**当前为空 —— 这是应有的状态。**
 *
 * 用「恰好等于」而不是「包含」:新增的越界类型会立刻红;而清单里的某条一旦修好,
 * 测试同样会红、逼着把它删掉 —— 不会变成悄悄延续下去的永久豁免。
 * (verification-card 曾在这里挂账,已随 CircleInvitationService 服务端签发修掉。)
 */
const KNOWN_UNFIXED_OFFENDERS = [];

test(
  'every type the client can send is on the backend client whitelist',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    // 这次事故的根因就在这条缝里:后端把 transfer-card 移进 SERVER_MESSAGE_TYPES,
    // 前端照旧发 —— 两边各自的测试都绿,只有比对才发现每一笔转账都在被拒。
    const allowed = backendClientMessageTypes();
    const offenders = [...frontendSendableTypes()]
      .filter((type) => !allowed.has(type))
      .sort();
    assert.deepEqual(
      offenders,
      [...KNOWN_UNFIXED_OFFENDERS].sort(),
      `客户端会发但后端 CLIENT_MESSAGE_TYPES 不收的类型:${offenders.join(', ')}`,
    );
  },
);

test(
  'transfer-card stays server-only on the backend',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const backend = fs.readFileSync(BACKEND_CONSTANTS_PATH, 'utf8');
    const serverOnly = backend.match(
      /export const SERVER_MESSAGE_TYPES: readonly string\[\] = \[([\s\S]*?)\];/,
    );
    assert.ok(serverOnly, 'circle_be 里找不到 SERVER_MESSAGE_TYPES');
    assert.match(serverOnly[1], /'transfer-card'/);
  },
);

/**
 * 跨仓契约测试自己的看门人。
 *
 * 这类测试「找不到后端就 skip」的设计对本地开发是对的,对 CI 是危险的:CI 此前
 * 只检出本仓库,于是 5 条跨仓契约(错误码注册表、聊天协议常量、敏感词错误码、
 * 朋友圈事件名、可发消息类型白名单)在每次 PR 上**全部静默跳过** —— 而它们要防的
 * 正是「前后端各自自洽、只有比对才看得见」的漂移,transfer-card 那次就是这么漏过去的。
 *
 * 所以 CI 必须并排检出后端,而这几行断言负责让那个接线不被悄悄删掉。
 */
test('CI checks out the backend so the cross-repo contracts actually run', () => {
  const ci = read('.github/workflows/ci.yml');
  const verify = ci.slice(ci.indexOf('\n  verify:'));

  // 后端与前端并排检出 —— 跨仓测试按 <cwd>/../circle_be 找源码。
  assert.match(verify, /repository: CircleTeamHub\/circle_be/);
  assert.match(verify, /path: circle_be/);
  assert.match(verify, /path: Circle_frontend/);
  assert.match(verify, /working-directory: Circle_frontend/);
  // npm 缓存键必须跟着前端的 lockfile 走,否则 setup-node 找不到它。
  assert.match(verify, /cache-dependency-path: Circle_frontend\/package-lock\.json/);
  // 布局一旦变动要 fail 而不是 skip:少了这道断言,5 条契约会安静地全部消失。
  assert.match(verify, /would silently skip/);
  // 有的跨仓测试还会因为**生产者符号消失**而退化成 skip(moments 那条:后端删掉
  // broadcastMomentsFeedUpdated 就跳过)。只查文件在不在挡不住这种,符号也要查。
  assert.match(verify, /require_symbol/);
  assert.match(verify, /broadcastMomentsFeedUpdated/);
});

/**
 * 从 TS 源码里按大括号配平抽出某个方法体。
 *
 * 断言必须落在**具体生产者函数内部**,不能对着整个后端搜 token:
 * `type: 'transfer-card'` 与 `gift_card_` 在补偿 cron 里也各有一份,
 * 把 CoinService 的结算后签发整段删掉,全局搜法照样全绿 —— 而那正是
 * 「转账成功、卡片再也不出现」的失效模式本身(客户端已经没有兜底发送路径了)。
 */
function methodBody(source, name) {
  // 锚定到行首 + 只允许可见性/async 修饰符 —— 否则会先匹配到调用点
  //（`this.issueTransferCard(`）而不是声明,抽出来的是错的函数体。
  const decl = new RegExp(
    `^\\s*(?:private\\s+|public\\s+|protected\\s+)?(?:async\\s+)?${name}\\s*\\(`,
    'm',
  ).exec(source);
  assert.ok(decl, `后端源码里找不到 ${name}(`);

  // 先把参数表的圆括号配平。直接找第一个 `{` 会抓到参数里的内联对象类型
  //（`options: { message: string | null }`),那不是函数体。
  let i = decl.index + decl[0].length - 1;
  let parens = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '(') parens += 1;
    else if (source[i] === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  const open = source.indexOf('{', i);
  assert.notEqual(open, -1, `${name} 没有函数体`);

  let depth = 0;
  for (let j = open; j < source.length; j += 1) {
    if (source[j] === '{') depth += 1;
    else if (source[j] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, j + 1);
    }
  }
  throw new Error(`${name} 的大括号没有配平`);
}

/**
 * 服务端签发的生产者清单:每一项都钉住「哪个文件的哪个方法里必须出现什么」。
 * 少任何一条,就意味着对应那张卡不再被签发。
 */
const PRODUCERS = [
  {
    label: '转账卡:结算提交后就地签发',
    file: 'src/coin/coin.service.ts',
    method: 'issueTransferCard',
    requires: [/type: 'transfer-card'/, /`gift_card_\$\{/, /amount/, /message/],
  },
  {
    label: '转账卡:sendGift 必须真的调用签发',
    file: 'src/coin/coin.service.ts',
    method: 'sendGift',
    requires: [/issueTransferCard\(/],
  },
  {
    label: '转账卡:补偿 cron 兜底',
    file: 'src/coin/gift-card-outbox.processor.ts',
    method: 'compensate',
    requires: [/type: 'transfer-card'/, /`gift_card_\$\{/],
  },
  {
    label: '验证卡:投递本体',
    file: 'src/circle-invitation/circle-invitation.service.ts',
    method: 'deliverVerificationCard',
    requires: [
      /type: 'verification-card'/,
      /`verification_card_\$\{/,
      /invitationId:/,
      /circleName:/,
      /applicantName:/,
    ],
  },
  {
    label: '验证卡:addVerifier 必须真的调用签发',
    file: 'src/circle-invitation/circle-invitation.service.ts',
    method: 'issueVerificationCard',
    requires: [/deliverVerificationCard\(/],
  },
];

/** 对给定的「文件 → 源码」读取器执行全部生产者断言;违反即抛。 */
function assertProducers(readBackendFile) {
  for (const producer of PRODUCERS) {
    const body = methodBody(readBackendFile(producer.file), producer.method);
    for (const pattern of producer.requires) {
      assert.match(
        body,
        pattern,
        `${producer.label} —— ${producer.method} 里少了 ${pattern}`,
      );
    }
  }
}

const readBackend = (rel) =>
  fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8');

test(
  'the backend actually issues both receipt cards',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    // 「类型是服务端专属」只说明客户端不能发,不说明服务端真的在发。两者都成立
    // 才是完整契约:生产者哪天被重构掉,而客户端这侧的发送路径已经被本 PR 删了,
    // 转账与加验证人照样成功、卡片却永远不出现,前后端测试全绿。
    assertProducers(readBackend);
  },
);

test(
  'removing any single producer call makes that contract fail',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    // 上面那条断言本身也需要被验证 —— 一条「永远绿」的契约测试比没有更糟。
    // 逐个把生产者里的关键调用抹掉,断言检查器确实会红。
    for (const producer of PRODUCERS) {
      const mutated = (rel) => {
        const source = readBackend(rel);
        if (rel !== producer.file) return source;
        const body = methodBody(source, producer.method);
        const broken = body.replace(
          new RegExp(producer.requires[0].source, 'g'),
          '/* removed */',
        );
        return source.replace(body, broken);
      };
      assert.throws(
        () => assertProducers(mutated),
        /少了/,
        `抹掉「${producer.label}」之后契约仍然通过 —— 这条断言是假的`,
      );
    }
  },
);
