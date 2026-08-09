const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 聊天页的会话身份归一。要防的是迁移窗口那条静默失效路径:
// 旧 OpenIM 推送带进来的 si_/sg_ 会话 id 非空,聊天页于是判成「有会话」——
// 页面看着正常,时间线是空的、发送必然失败,而入口只给了这一个 id。
function runModule(rel, requireFn) {
  const filePath = path.join(process.cwd(), rel);
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    console: { warn: () => {} },
    module: { exports: {} },
    exports: {},
    require: requireFn,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context);
  return context.module.exports;
}

function loadIdentity() {
  return runModule('src/features/chat/chat-detail-identity.ts', (request) => {
    if (request === '@/chat-core/conversation-id') {
      return runModule('src/chat-core/conversation-id.ts', () => {
        throw new Error('conversation-id should have no runtime deps');
      });
    }
    if (request === '@/features/call/resolve-direct-callee') {
      return runModule('src/features/call/resolve-direct-callee.ts', (inner) => {
        if (inner === '@/utils/user-id-alias') {
          return runModule('src/utils/user-id-alias.ts', () => {
            throw new Error('user-id-alias should have no runtime deps');
          });
        }
        throw new Error(`unexpected import: ${inner}`);
      });
    }
    throw new Error(`unexpected import: ${request}`);
  });
}

const SELF = '11111111-2222-3333-4444-555555555555';
const PEER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CONV = '3f2a1c4e-9b7d-4e21-8a55-6c0d1e2f3a4b';

test('a real conversation id passes through untouched', () => {
  const { resolveChatDetailIdentity } = loadIdentity();
  assert.deepEqual(
    {
      ...resolveChatDetailIdentity({
        conversationID: CONV,
        sourceID: PEER,
        currentUserID: SELF,
      }),
    },
    { conversationID: CONV, sourceID: PEER },
  );
});

test('a legacy si_ push is recovered into a usable peer id', () => {
  // 托盘里压着的旧推送:两个入参都是 si_<a>_<b>。原来 conversationID 非空就
  // 被当成真会话 —— 空时间线 + 发送必失败,而且没有任何别的路能恢复。
  const { resolveChatDetailIdentity } = loadIdentity();
  const legacy = `si_${PEER}_${SELF}`;
  assert.deepEqual(
    {
      ...resolveChatDetailIdentity({
        conversationID: legacy,
        sourceID: legacy,
        currentUserID: SELF,
      }),
    },
    // conversationID 清空 → 聊天页走 ensureDirectConversation(对端) 建/取真会话。
    { conversationID: '', sourceID: PEER },
  );
});

test('si_ recovery works regardless of which half is me', () => {
  const { resolveChatDetailIdentity } = loadIdentity();
  for (const legacy of [`si_${PEER}_${SELF}`, `si_${SELF}_${PEER}`]) {
    assert.equal(
      resolveChatDetailIdentity({
        conversationID: legacy,
        sourceID: legacy,
        currentUserID: SELF,
      }).sourceID,
      PEER,
    );
  }
});

test("someone else's si_ id is not turned into a callable peer", () => {
  // 自己不在这两段里 → 这不是我的会话 id(伪造深链)。猜一个「另一段」
  // 等于把任意 id 当对端交给后端。
  const { resolveChatDetailIdentity } = loadIdentity();
  const foreign = `si_${PEER}_bbbbbbbb-cccc-dddd-eeee-ffffffffffff`;
  const resolved = resolveChatDetailIdentity({
    conversationID: foreign,
    sourceID: foreign,
    currentUserID: SELF,
  });
  assert.equal(resolved.conversationID, '');
  // 还原失败就把原值留着 —— 上层拿它建会话会失败并落到预览态,
  // 这比静悄悄进一个「别人的」会话安全。
  assert.equal(resolved.sourceID, foreign);
});

test('legacy group ids fall back to preview instead of an empty conversation', () => {
  // sg_ 两段是群相关 id,还原不出圈子 id。conversationID 必须清掉,
  // 否则聊天页进的是一个永远空的会话。
  const { resolveChatDetailIdentity } = loadIdentity();
  const resolved = resolveChatDetailIdentity({
    conversationID: 'sg_legacy-group',
    sourceID: 'sg_legacy-group',
    currentUserID: SELF,
  });
  assert.equal(resolved.conversationID, '');
  assert.equal(resolved.sourceID, 'sg_legacy-group');
});

test('non-string params never reach the store as a conversation id', () => {
  const { resolveChatDetailIdentity } = loadIdentity();
  for (const bad of [undefined, null, 42, ['a'], { id: 'x' }]) {
    assert.deepEqual(
      {
        ...resolveChatDetailIdentity({
          conversationID: bad,
          sourceID: bad,
          currentUserID: SELF,
        }),
      },
      { conversationID: '', sourceID: '' },
    );
  }
});

test('conversation ids are UUIDs — no other shape is accepted', () => {
  const { isChatConversationId } = runModule(
    'src/chat-core/conversation-id.ts',
    () => {
      throw new Error('conversation-id should have no runtime deps');
    },
  );
  assert.equal(isChatConversationId(CONV), true);
  assert.equal(isChatConversationId(`  ${CONV}  `), true);
  // 后端从不下发这种形状(directKey 是服务端内部的唯一约束键,不出服务端)。
  assert.equal(isChatConversationId(`direct:${SELF}:${PEER}`), false);
  assert.equal(isChatConversationId(`si_${SELF}_${PEER}`), false);
  assert.equal(isChatConversationId(CONV.replace(/-/g, '')), false);
  assert.equal(isChatConversationId(''), false);
  assert.equal(isChatConversationId(null), false);
});
