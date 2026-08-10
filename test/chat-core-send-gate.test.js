const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const __localDbStub = {
  persistLocalConversations: async () => {},
  upsertLocalConversation: async () => {},
  removeLocalConversation: async () => {},
  persistLocalMessages: async () => {},
  deleteLocalMessage: async () => {},
  clearLocalConversationMessages: async () => {},
  deleteLocalMessagesBelow: async () => {},
  readRecentLocalMessages: async () => [],
  readLocalConversations: async () => [],
  searchLocalChatMessages: async () => [],
  outboxUpsert: async () => {},
  outboxDelete: async () => {},
  outboxList: async () => [],
  pendingReadUpsert: async () => {},
  pendingReadDelete: async () => {},
  pendingReadsList: async () => [],
  initChatLocalDb: async () => false,
  wipeChatLocalDb: async () => {},
};


// 信用分门禁必须挂在 chat-core 的共享发送路径上。拆栈前它在 reportSend 包装器里,
// 迁移后只剩发图路径单独调了一次 —— 低于阈值的用户仍能发文本/引用/语音/位置/卡片。
// 后端刻意不做这道校验(策略在端上),所以端上漏了就是真的漏了。
function loadClient({ blocked }) {
  const filePath = path.join(process.cwd(), 'src/chat-core/client.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const calls = { ingest: 0, applied: 0, sent: 0, gate: 0, reported: [] };
  class CreditPolicyError extends Error {}
  const storeState = {
    ingestMessages: () => {
      calls.ingest += 1;
    },
    applyIncomingMessage: () => {
      calls.applied += 1;
      return true;
    },
    markMessageFailed: () => {},
    revertConversationPreview: () => {},
    upsertConversation: () => {},
    messagesByConversation: {},
    conversations: [],
  };

  const context = {
    Date,
    Math,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === '@/services/api/credit-policy') {
        return {
          assertLocalCanSendMessage: () => {
            calls.gate += 1;
            if (blocked) throw new CreditPolicyError('LOW_CREDIT_SCORE');
          },
        };
      }
      if (request === '@/stores/authStore') {
        return {
          useAuthStore: {
            getState: () => ({
              user: { id: 'me', nickname: '我', avatarUrl: null },
              sessionEpoch: 1,
            }),
          },
        };
      }
      if (request === './api') {
        return {
          createCircleChatConversation: async () => ({ id: 'c1' }),
          createDirectChatConversation: async () => ({ id: 'c1' }),
          loadChatHistory: async () => ({ messages: [], nextBeforeHeight: null }),
        };
      }
      if (request === './socket-manager') {
        return {
          ChatSendError: class extends Error {},
          createDeliveryId: () => 'd-test',
          markConversationRead: () => {},
          sendChatMessage: async () => {
            calls.sent += 1;
            return { messageId: 'm1', height: 1 };
          },
        };
      }
      if (request === './store') {
        return { useChatStore: { getState: () => storeState } };
      }
      if (request === './send-errors') {
        return {
          reportChatSendFailure: (type, error) => {
            calls.reported.push({ type, code: error?.code ?? null });
          },
        };
      }
      if (request === './protocol') return {};
      if (request === './local-db') return __localDbStub;
    throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context);
  return { api: context.module.exports, calls, CreditPolicyError };
}

test('every public send API is gated on credit score', async () => {
  const { api, calls } = loadClient({ blocked: true });

  const sends = [
    () => api.sendTextMessage({ conversationId: 'c1', text: 'hi' }),
    () =>
      api.sendQuoteMessage({ conversationId: 'c1', text: 'hi', quotedText: 'q' }),
    () => api.sendVoiceMessage({ conversationId: 'c1', key: 'k', duration: 1 }),
    () =>
      api.sendLocationMessage({
        conversationId: 'c1',
        latitude: 1,
        longitude: 2,
        description: 'x',
      }),
    () =>
      api.sendCardMessage({
        conversationId: 'c1',
        type: 'note-card',
        payload: {},
      }),
    () => api.sendImageMessage({ conversationId: 'c1', key: 'k' }),
  ];

  for (const send of sends) {
    await assert.rejects(send());
  }
  assert.equal(calls.gate, sends.length);
  // 被拦的发送不该在时间线里留下痕迹,也不该碰 socket。
  assert.equal(calls.ingest, 0);
  assert.equal(calls.applied, 0);
  assert.equal(calls.sent, 0);
});

test('a normal user still sends through the same path', async () => {
  const { api, calls } = loadClient({ blocked: false });
  await api.sendTextMessage({ conversationId: 'c1', text: 'hi' });
  assert.equal(calls.gate, 1);
  assert.equal(calls.sent, 1);
  assert.ok(calls.ingest > 0);
});

test('the already-paid transfer card is the one thing the gate must let through', async () => {
  // 转账是两段式:TransferComposerScreen 先 await sendCoinGift(积分真扣真到账),
  // 回到聊天页才发这张卡片作为回执。在卡片这一步拦掉阻止不了任何事 ——
  // 付款方看不到卡片、以为没发出去,回转账页重试会生成新的幂等键,
  // 那就是第二次真实扣款。门禁的正确位置在扣款之前(handleSubmit 已补)。
  const { api, calls } = loadClient({ blocked: true });

  const sent = await api.sendCardMessage({
    conversationId: 'c1',
    type: 'transfer-card',
    payload: { amount: 10, message: null },
    bypassCreditGate: true,
  });

  assert.equal(sent.type, 'transfer-card');
  assert.equal(calls.gate, 0, '豁免路径不该再问门禁');
  assert.equal(calls.sent, 1);
});

test('the bypass is opt-in only — every other card still hits the gate', async () => {
  // 豁免是逐次显式传的,不是按类型放行:漏成默认值的话整条卡片路径都没门禁了。
  const { api, calls } = loadClient({ blocked: true });
  await assert.rejects(
    api.sendCardMessage({
      conversationId: 'c1',
      type: 'transfer-card',
      payload: { amount: 10, message: null },
    }),
  );
  assert.equal(calls.gate, 1);
  assert.equal(calls.sent, 0);
});

test('a low-credit user never gets asked for their location', () => {
  // sendLocationMessage 里那道门禁是共享路径的兜底,但它要等到「已经申请过
  // 定位权限、读完当前坐标、还做了一次反地理编码」之后才拒 —— 一次注定失败的
  // 发送,不该先把用户的精确位置读出来。门禁必须在取位置之前也有一道。
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );
  const handler = source.slice(
    source.indexOf('const handleSendCurrentLocation'),
    source.indexOf('const permission = await Location.requestForegroundPermissionsAsync'),
  );
  assert.ok(
    handler.includes('getLocalLowCreditDecision()'),
    '取定位权限之前没有信用分门禁',
  );
});
