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
