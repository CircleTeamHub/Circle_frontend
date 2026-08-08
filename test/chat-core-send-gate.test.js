const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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

  const calls = { ingest: 0, applied: 0, sent: 0, gate: 0 };
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
      if (request === './protocol') return {};
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
