import test from 'node:test';
import assert from 'node:assert/strict';
import { useCallStore } from './use-call-store.ts';

const invite = {
  callId: 'call-1',
  conversationID: 'sg_group-1',
  sessionType: 'group' as const,
  callType: 'AUDIO' as const,
  initiator: { id: 'user-1', nickname: 'Alice', avatarUrl: null },
  invitees: [{ id: 'user-2', nickname: 'Bob', avatarUrl: null }],
  expiresAt: '2026-06-11T03:00:45.000Z',
  createdAt: '2026-06-11T03:00:00.000Z',
};

test('stores an incoming call invite', () => {
  useCallStore.getState().resetCallState();

  useCallStore.getState().handleCallInvite(invite);

  assert.equal(useCallStore.getState().incomingCall?.callId, 'call-1');
  assert.equal(useCallStore.getState().activeCall?.status, 'RINGING');
  assert.equal(useCallStore.getState().livekit, null);
});

test('marks participants as joined from realtime updates', () => {
  useCallStore.getState().resetCallState();
  useCallStore.getState().handleCallInvite(invite);

  useCallStore.getState().handleCallParticipantJoined({
    callId: 'call-1',
    user: { id: 'user-2', nickname: 'Bob', avatarUrl: null },
    joinedAt: '2026-06-11T03:00:10.000Z',
    changedAt: '2026-06-11T03:00:10.000Z',
  });

  const bob = useCallStore
    .getState()
    .activeCall?.participants.find((participant) => participant.user.id === 'user-2');
  assert.equal(bob?.status, 'JOINED');
  assert.equal(bob?.joinedAt, '2026-06-11T03:00:10.000Z');
});

test('stores LiveKit credentials for an accepted or started call', () => {
  useCallStore.getState().resetCallState();

  useCallStore.getState().setActiveCall(
    {
      id: 'call-2',
      conversationID: 'sg_group-1',
      sessionType: 'group',
      callType: 'AUDIO',
      status: 'ACTIVE',
      initiator: { id: 'user-1', nickname: 'Alice', avatarUrl: null },
      startedAt: '2026-06-11T03:00:00.000Z',
      endedAt: null,
      expiresAt: null,
      durationSeconds: null,
      endReason: null,
      participants: [],
    },
    {
      url: 'wss://example.livekit.cloud',
      token: 'livekit-token',
      expiresAt: '2026-06-11T04:00:00.000Z',
    },
  );

  assert.equal(useCallStore.getState().activeCall?.id, 'call-2');
  assert.equal(useCallStore.getState().livekit?.token, 'livekit-token');
});

test('marks participants as rejected from realtime updates', () => {
  useCallStore.getState().resetCallState();
  useCallStore.getState().handleCallInvite(invite);

  useCallStore.getState().handleCallParticipantRejected({
    callId: 'call-1',
    user: { id: 'user-2', nickname: 'Bob', avatarUrl: null },
    rejectedAt: '2026-06-11T03:00:10.000Z',
    changedAt: '2026-06-11T03:00:10.000Z',
  });

  const bob = useCallStore
    .getState()
    .activeCall?.participants.find((participant) => participant.user.id === 'user-2');
  assert.equal(bob?.status, 'REJECTED');
});

test('marks participants as missed from realtime updates', () => {
  useCallStore.getState().resetCallState();
  useCallStore.getState().handleCallInvite(invite);

  useCallStore.getState().handleCallParticipantMissed({
    callId: 'call-1',
    user: { id: 'user-2', nickname: 'Bob', avatarUrl: null },
    missedAt: '2026-06-11T03:00:45.000Z',
    changedAt: '2026-06-11T03:00:45.000Z',
  });

  const bob = useCallStore
    .getState()
    .activeCall?.participants.find((participant) => participant.user.id === 'user-2');
  assert.equal(bob?.status, 'MISSED');
  assert.equal(bob?.leftAt, '2026-06-11T03:00:45.000Z');
});

test('clears active call state when a call ends', () => {
  useCallStore.getState().resetCallState();
  useCallStore.getState().handleCallInvite(invite);

  useCallStore.getState().handleCallEnded({
    callId: 'call-1',
    status: 'ENDED',
    endReason: 'ALL_LEFT',
    endedAt: '2026-06-11T03:02:00.000Z',
    changedAt: '2026-06-11T03:02:00.000Z',
  });

  assert.equal(useCallStore.getState().incomingCall, null);
  assert.equal(useCallStore.getState().activeCall, null);
  assert.equal(useCallStore.getState().livekit, null);
});
