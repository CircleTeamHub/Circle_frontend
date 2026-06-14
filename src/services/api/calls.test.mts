import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCallActionResponse } from './call-mappers.ts';

const call = {
  id: 'call-1',
  conversationID: 'sg_group-1',
  sessionType: 'group',
  callType: 'AUDIO',
  status: 'ACTIVE',
  livekitRoomName: 'circle_call_1',
  initiator: { id: 'user-1', nickname: 'Alice', avatarUrl: null },
  startedAt: '2026-06-11T03:00:00.000Z',
  endedAt: null,
  expiresAt: null,
  durationSeconds: null,
  endReason: null,
  participants: [
    {
      user: { id: 'user-1', nickname: 'Alice', avatarUrl: null },
      status: 'JOINED',
      invitedAt: '2026-06-11T03:00:00.000Z',
      joinedAt: '2026-06-11T03:00:00.000Z',
      leftAt: null,
    },
  ],
};

test('normalizes call action responses with nested livekit credentials', () => {
  const normalized = normalizeCallActionResponse({
    call,
    selfParticipant: call.participants[0],
    livekit: {
      url: 'wss://livekit.example.com',
      token: 'token-1',
      expiresAt: '2026-06-11T04:00:00.000Z',
    },
  });

  assert.equal(normalized.call.id, 'call-1');
  assert.equal(normalized.livekit.url, 'wss://livekit.example.com');
  assert.equal(normalized.livekit.token, 'token-1');
});

test('normalizes call action responses with legacy top-level livekitUrl', () => {
  const normalized = normalizeCallActionResponse({
    call,
    selfParticipant: null,
    livekitUrl: 'wss://legacy.livekit.example.com',
    token: 'token-2',
    expiresAt: '2026-06-11T04:00:00.000Z',
  });

  assert.equal(normalized.livekit.url, 'wss://legacy.livekit.example.com');
  assert.equal(normalized.livekit.token, 'token-2');
});

test('rejects malformed call action responses', () => {
  assert.throws(
    () =>
      normalizeCallActionResponse({
        call: { id: 'call-1' },
        livekit: { url: 'wss://livekit.example.com' },
      }),
    /无效通话数据/,
  );
});
