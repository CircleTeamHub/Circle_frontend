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
function loadClient({ blocked, sendFails = false }) {
  const filePath = path.join(process.cwd(), 'src/chat-core/client.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const calls = {
    ingest: 0,
    applied: 0,
    sent: 0,
    gate: 0,
    reported: [],
    outboxUpserts: [],
    sentPayloads: [],
    failedMarks: [],
    removed: [],
  };
  class CreditPolicyError extends Error {}
  const storeState = {
    ingestMessages: () => {
      calls.ingest += 1;
    },
    applyIncomingMessage: () => {
      calls.applied += 1;
      return true;
    },
    markMessageFailed: (conversationId, d) => {
      calls.failedMarks.push({ conversationId, d });
    },
    removeMessage: (conversationId, messageId) => {
      calls.removed.push({ conversationId, messageId });
    },
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
          sendChatMessage: async (payload) => {
            calls.sent += 1;
            calls.sentPayloads.push(payload);
            if (sendFails) throw new Error('ack timeout');
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
      // protocol.ts 零依赖,直接跑真的 —— SERVER_COMPENSATED_TYPES 是生产
      // 常量,桩一份的话两边会各自漂移。
      if (request === './protocol') {
        const protocolPath = path.join(process.cwd(), 'src/chat-core/protocol.ts');
        const protocolCtx = { module: { exports: {} }, exports: {}, require: () => {
          throw new Error('protocol should have no runtime deps');
        } };
        protocolCtx.exports = protocolCtx.module.exports;
        vm.runInNewContext(
          ts.transpileModule(fs.readFileSync(protocolPath, 'utf8'), {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2020,
            },
            fileName: protocolPath,
          }).outputText,
          protocolCtx,
        );
        return protocolCtx.module.exports;
      }
      if (request === './local-db') {
        return {
          ...__localDbStub,
          outboxUpsert: async (entry) => {
            calls.outboxUpserts.push(entry.payload.type);
          },
        };
      }
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

test('转账卡片不进 outbox —— 后端补发,客户端重发只会多一张回执', async () => {
  const { api, calls } = loadClient({ blocked: false });

  await api.sendTextMessage({ conversationId: 'c1', text: 'hi' });
  await api.sendCardMessage({
    conversationId: 'c1',
    type: 'transfer-card',
    payload: { amount: 100, message: null },
    bypassCreditGate: true,
  });

  // 普通消息照常入队(App 被杀后要还原成失败气泡重发),转账卡片不入。
  assert.deepEqual(calls.outboxUpserts, ['text']);
});

test('转账卡片发失败不留失败气泡(后端马上补发权威版本)', async () => {
  const { api, calls } = loadClient({ blocked: false, sendFails: true });

  await assert.rejects(() =>
    api.sendCardMessage({
      conversationId: 'c1',
      type: 'transfer-card',
      payload: { amount: 100, message: null },
      bypassCreditGate: true,
    }),
  );

  // 不标失败:留着就是一张永远发不出去、还排在时间线最底下的幽灵卡。
  assert.deepEqual(calls.failedMarks, []);
  assert.deepEqual(calls.removed, [
    { conversationId: 'c1', messageId: 'local:d-test' },
  ]);
});

test('普通消息发失败照旧标失败态,留着长按重发', async () => {
  const { api, calls } = loadClient({ blocked: false, sendFails: true });

  await assert.rejects(() =>
    api.sendTextMessage({ conversationId: 'c1', text: 'hi' }),
  );

  assert.deepEqual(calls.failedMarks, [{ conversationId: 'c1', d: 'd-test' }]);
  assert.deepEqual(calls.removed, []);
});

test('媒体消息:先上屏一个「发送中」气泡,上传还没开始就已经能看见', () => {
  const { api, calls } = loadClient({ blocked: false });

  const d = api.startMediaSend({
    conversationId: 'c1',
    type: 'voice',
    localContent: { duration: 3, localUri: 'file:///tmp/a.m4a' },
    retry: async () => {},
  });

  assert.equal(typeof d, 'string');
  // 上屏了,而且这时候一次网络请求都还没发。
  assert.equal(calls.ingest, 1);
  assert.equal(calls.applied, 1);
  assert.equal(calls.sent, 0);
  assert.deepEqual(calls.outboxUpserts, []);
});

test('媒体上传失败:气泡标红并退回预览,不是凭空消失', () => {
  const { api, calls } = loadClient({ blocked: false });

  const d = api.startMediaSend({
    conversationId: 'c1',
    type: 'image',
    localContent: { localUri: 'file:///tmp/a.jpg' },
    retry: async () => {},
  });
  api.failMediaSend('c1', d);

  assert.deepEqual(calls.failedMarks, [{ conversationId: 'c1', d }]);
});

test('媒体重发走「重跑上传」,不去 outbox 找那条根本没入队的消息', async () => {
  const { api } = loadClient({ blocked: false });

  const retried = [];
  const d = api.startMediaSend({
    conversationId: 'c1',
    type: 'voice',
    localContent: { duration: 3, localUri: 'file:///tmp/a.m4a' },
    retry: async (id) => {
      retried.push(id);
    },
  });
  api.failMediaSend('c1', d);

  await api.retryFailedChatMessage('c1', d);

  // 拿到的必须是同一个 d —— 否则重发会在时间线里多出一条,红气泡还留着。
  assert.deepEqual(retried, [d]);
});

test('发送成功后重试闭包被清掉(不再抓着那个本地文件)', async () => {
  const { api } = loadClient({ blocked: false });

  const d = api.startMediaSend({
    conversationId: 'c1',
    type: 'voice',
    localContent: { duration: 3, localUri: 'file:///tmp/a.m4a' },
    retry: async () => {
      throw new Error('不该再被调用');
    },
  });
  api.finishMediaSend(d);

  // 清掉之后再重发就落回 outbox 分支 —— 那里没有这条,按契约抛错。
  await assert.rejects(() => api.retryFailedChatMessage('c1', d));
});

test('媒体发送复用已上屏气泡的 d,不会再造一条', async () => {
  const { api, calls } = loadClient({ blocked: false });

  await api.sendVoiceMessage({
    conversationId: 'c1',
    key: 'chat/me/a.m4a',
    duration: 3,
    deliveryId: 'd-existing',
  });

  const sentPayload = calls.sentPayloads.at(-1);
  assert.equal(sentPayload.d, 'd-existing');
});
