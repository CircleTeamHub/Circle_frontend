const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// calls API（行为）
// ---------------------------------------------------------------------------

function loadCallsApi(responses) {
  const requests = [];
  const mappers = loadTsModule('src/services/api/call-mappers.ts');
  const mod = loadTsModule('src/services/api/calls.ts', {
    requireShim: (specifier) => {
      if (specifier === './client') {
        return {
          apiClient: async (endpoint, options) => {
            requests.push({ endpoint, options });
            return responses(endpoint);
          },
        };
      }
      if (specifier === './call-mappers') return mappers;
      throw new Error(`unexpected import in calls api: ${specifier}`);
    },
  });
  return { mod, requests };
}

const CALL_FIXTURE = {
  id: 'call-1',
  conversationID: 'si_a_b',
  sessionType: 'single',
  callType: 'AUDIO',
  status: 'RINGING',
  initiator: { id: 'u1', nickname: 'Alice', avatarUrl: null },
  startedAt: null,
  endedAt: null,
  expiresAt: '2026-07-21T03:10:00.000Z',
  durationSeconds: null,
  endReason: null,
  participants: [],
};

test('createDirectCall 打到 POST /calls/direct 并归一化响应 (#113)', async () => {
  const { mod, requests } = loadCallsApi(() => ({
    call: CALL_FIXTURE,
    selfParticipant: null,
    livekit: {
      url: 'wss://lk',
      token: 'tok',
      expiresAt: '2026-07-21T04:00:00.000Z',
    },
  }));

  const result = await mod.createDirectCall({
    calleeID: 'u2',
    callType: 'AUDIO',
  });

  assert.equal(requests[0].endpoint, '/calls/direct');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(requests[0].options.body, {
    calleeID: 'u2',
    callType: 'AUDIO',
  });
  assert.equal(result.call.sessionType, 'single');
  assert.equal(result.livekit.token, 'tok');
});

test('fetchCurrentCall：无通话返回 null，有通话归一化且不要求 LiveKit 凭据 (#93)', async () => {
  const none = loadCallsApi(() => ({ call: null, selfParticipant: null }));
  assert.equal(await none.mod.fetchCurrentCall(), null);
  assert.equal(none.requests[0].endpoint, '/calls/current');

  const active = loadCallsApi(() => ({
    call: CALL_FIXTURE,
    selfParticipant: {
      userID: 'u1',
      status: 'JOINED',
      user: { id: 'u1', nickname: 'Alice', avatarUrl: null },
    },
  }));
  const result = await active.mod.fetchCurrentCall();
  assert.equal(result.call.id, 'call-1');
  assert.equal(result.selfParticipant.status, 'JOINED');
});

// ---------------------------------------------------------------------------
// 接线断言
// ---------------------------------------------------------------------------

test('1:1 聊天页与用户主页都接上了 direct call（FE#90 不再「即将上线」）', () => {
  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  // 1:1 分支走 direct，群聊保持原群呼路径
  assert.match(chat, /if \(!isGroupChat\) \{\s*const response = await createDirectCall\(\{/);
  assert.match(chat, /calleeID: sourceID,/);
  // 不再存在「仅群聊可用」的拦截
  assert.doesNotMatch(chat, /chat\.call\.groupOnly/);

  const profile = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(profile, /createDirectCall\(\{\s*calleeID: profileId,/);
  assert.doesNotMatch(profile, /avCallComingSoon/);
});

test('call_record 自定义消息按 extension 判别渲染为通话记录气泡 (#115 客户端)', () => {
  const client = read('src/im/client.ts');
  assert.match(client, /CALL_RECORD_EXTENSION = 'call-record-v1'/);

  const mappers = read('src/im/mappers.ts');
  assert.match(mappers, /ext === CALL_RECORD_EXTENSION/);
  assert.match(mappers, /type: 'call-record'/);
  // 会话列表预览
  assert.match(mappers, /voiceCall/);

  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(chat, /case 'call-record':/);
  // 1:1 点卡片可回拨，群聊不接（避免误触发全群振铃）
  assert.match(chat, /onCallBack=\{isGroupChat \? undefined : handleStartCall\}/);

  const bubble = read('src/features/chat/components/bubbles/call-record-bubble.tsx');
  assert.match(bubble, /chat\.callRecord\.duration/);
  assert.match(bubble, /chat\.callRecord\.missed/);
});

test('parseCallRecordData 从宽解析，坏数据不炸', () => {
  const mappers = loadTsModule('src/im/mappers.ts', {
    requireShim: (specifier) => {
      if (specifier === '@openim/rn-client-sdk') {
        return { MessageType: {}, SessionType: { Single: 1, Group: 3 } };
      }
      if (specifier === '@/im/client') {
        return {
          NOTE_CARD_EXTENSION: 'note-card-v1',
          TRANSFER_CARD_EXTENSION: 'transfer-card-v1',
          VERIFICATION_CARD_EXTENSION: 'verification-card-v1',
          PLAZA_POST_CARD_EXTENSION: 'plaza-post-card-v1',
          CALL_RECORD_EXTENSION: 'call-record-v1',
          FRIEND_ADDED_NOTICE_EXTENSION: 'friend-added-v1',
          fromImUserId: (v) => v,
        };
      }
      if (specifier === '@/services/api/utils') {
        return { normalizeMediaUrl: (v) => v };
      }
      if (specifier === '@/i18n') {
        return { __esModule: true, default: { t: (_k, o) => o?.defaultValue ?? _k } };
      }
      if (specifier === '@/utils/locale') {
        return { getLocalizedDateTimeLocale: () => 'zh-CN' };
      }
      throw new Error(`unexpected import in mappers: ${specifier}`);
    },
  });

  const good = mappers.parseCallRecordData(
    JSON.stringify({
      type: 'call_record',
      callId: 'c1',
      callType: 'AUDIO',
      sessionType: 'single',
      endReason: 'NO_ANSWER',
      durationSeconds: null,
      initiatorID: 'u1',
    }),
  );
  assert.equal(good.callId, 'c1');
  assert.equal(good.endReason, 'NO_ANSWER');

  assert.equal(mappers.parseCallRecordData('not json'), null);
  assert.equal(
    mappers.parseCallRecordData(JSON.stringify({ type: 'other' })),
    null,
  );
  // durationSeconds 负数视为无效
  const clamped = mappers.parseCallRecordData(
    JSON.stringify({ type: 'call_record', callId: 'c2', durationSeconds: -5 }),
  );
  assert.equal(clamped.durationSeconds, null);
});

test('回前台通话对账：本地残留在服务端已消失时被清掉 (#93)', () => {
  const hook = read('src/features/call/hooks/use-call-reconciliation.ts');
  assert.match(hook, /fetchCurrentCall\(\)/);
  assert.match(hook, /resetCallState\(\)/);
  // 只在本地有通话态时才查询；「服务端有本地没有」不自动闯入
  assert.match(hook, /if \(!activeCall && !incomingCall\)/);

  const host = read('src/features/call/components/CallInviteHost.tsx');
  assert.match(host, /useCallReconciliation\(\)/);
});

test('对账在请求前捕获目标 callId，在飞期间来的新电话不被误清 (review)', () => {
  const hook = read('src/features/call/hooks/use-call-reconciliation.ts');
  // 捕获发生在 fetchCurrentCall 之前
  const captureAt = hook.indexOf('const reconcilingCallId');
  const fetchAt = hook.indexOf('void fetchCurrentCall()');
  assert.ok(captureAt >= 0 && fetchAt >= 0 && captureAt < fetchAt,
    'reconcilingCallId must be captured before the request');
  // 回调里比对：store 已换电话（B）→ 丢弃这份过期响应，不 reset
  assert.match(hook, /localCallId !== reconcilingCallId/);
});

test('主页拨打用同步 ref 守卫，快速双击不双发 POST /calls/direct (review)', () => {
  const screen = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(screen, /const callStartingRef = useRef\(false\)/);
  // 进入即置位、finally 清理（state 版只留给按钮 UI）
  assert.match(screen, /callStartingRef\.current \|\|/);
  assert.match(screen, /callStartingRef\.current = true;/);
  assert.match(screen, /callStartingRef\.current = false;/);
});

test('通话记录气泡：群聊无回拨仍可长按；ALL_LEFT 显示时长 (review)', () => {
  const bubble = read(
    'src/features/chat/components/bubbles/call-record-bubble.tsx',
  );
  // 只有 tap 与长按都缺席才禁用 —— 群聊 onCallBack=undefined 时操作菜单仍可用
  assert.match(bubble, /disabled=\{!onCallBack && !onLongPress\}/);
  // 接通过的终局（NORMAL/ALL_LEFT）带时长都渲染时长文案
  assert.match(bubble, /connectedEndReasons = new Set\(\['NORMAL', 'ALL_LEFT'\]\)/);
  assert.match(bubble, /connectedEndReasons\.has\(record\.endReason\)/);
});
