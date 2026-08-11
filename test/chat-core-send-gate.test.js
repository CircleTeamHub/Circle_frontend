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
    retryMarks: [],
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
    markMessageRetrying: (conversationId, d) => {
      calls.retryMarks.push({ conversationId, d });
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

test('the gate has no bypass hatch left', async () => {
  // 曾经有一个 bypassCreditGate,唯一用途是转账卡片(「钱已经动了、拦也白拦」)。
  // 那张卡现在由服务端结算后签发,客户端根本不走这条路径 —— 豁免口子也就没有
  // 存在理由了。留着它的风险是下一个调用方顺手打开,把整条卡片路径的门禁绕过去。
  const { api, calls } = loadClient({ blocked: true });

  await assert.rejects(
    api.sendCardMessage({
      conversationId: 'c1',
      type: 'note-card',
      payload: {},
      bypassCreditGate: true,
    }),
    '未知参数不该把门禁关掉',
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

// #156 曾在发送路径上给转账卡片开两条特例(不入 outbox、失败不留气泡),
// 用来压住「客户端发一张必然被服务端拒的卡」的症状。现在病根拆了 ——
// 回执类卡片压根不走客户端发送路径 —— 那两条特例随之不可达,已经删除。
// 这里改钉住「发送路径上不再有任何类型走特例」这件事本身。
test('发送路径上没有服务端补发类型的特例分支了', async () => {
  const { api, calls } = loadClient({ blocked: false });

  await api.sendTextMessage({ conversationId: 'c1', text: 'hi' });
  await api.sendCardMessage({
    conversationId: 'c1',
    type: 'note-card',
    payload: {},
  });

  // 能走到发送路径的每一种类型都照常入队(App 被杀后还原成失败气泡重发)。
  assert.deepEqual(calls.outboxUpserts, ['text', 'note-card']);

  // 客户端可发的卡片枚举里不该再出现回执类类型 —— 它们由服务端签发。
  const client = fs.readFileSync(
    path.join(process.cwd(), 'src/chat-core/client.ts'),
    'utf8',
  );
  const union = client.match(/export type ChatCardType =([\s\S]*?);/)[1];
  assert.doesNotMatch(union, /'transfer-card'|'verification-card'/);
  // 发送侧也不该再引用它 —— SERVER_COMPENSATED_TYPES 现在只服务于
  // socket-manager 里对旧版本脏 outbox 条目的清理。
  assert.doesNotMatch(client, /SERVER_COMPENSATED_TYPES\.has/);
});

test('卡片发失败与普通消息一样标失败态(不再有 removeMessage 特例)', async () => {
  const { api, calls } = loadClient({ blocked: false, sendFails: true });

  await assert.rejects(() =>
    api.sendCardMessage({
      conversationId: 'c1',
      type: 'note-card',
      payload: {},
    }),
  );

  assert.deepEqual(calls.failedMarks, [{ conversationId: 'c1', d: 'd-test' }]);
  assert.deepEqual(calls.removed, []);
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
