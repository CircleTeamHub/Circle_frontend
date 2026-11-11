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

// resetCallState 会把当前那通记成「刚结束」（迟到的邀请不再响）：用例之间要的是一张白纸。
function resetStore() {
  useCallStore.setState({
    incomingCall: null,
    activeCall: null,
    livekit: null,
    answeringCallId: null,
    recentlyEndedCallIds: [],
    inviteGenerations: {},
    isMinimized: false,
    lastDismissal: null,
    nativeUiFallbackCallId: null,
  });
}

test('stores an incoming call invite', () => {
  resetStore();

  useCallStore.getState().handleCallInvite(invite);

  assert.equal(useCallStore.getState().incomingCall?.callId, 'call-1');
  assert.equal(useCallStore.getState().activeCall?.status, 'RINGING');
  assert.equal(useCallStore.getState().livekit, null);
});

test('marks participants as joined from realtime updates', () => {
  resetStore();
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
  resetStore();

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
  resetStore();
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

test('clears active call state when a call ends', () => {
  resetStore();
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

test('ignores a duplicate invite for the call that is already ringing', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);
  const first = useCallStore.getState().incomingCall;

  // WS 与推送（回前台对账）各送来一次。
  useCallStore.getState().handleCallInvite({ ...invite, invitees: [] });

  assert.equal(useCallStore.getState().incomingCall, first);
});

test('does not ring again for a call that already ended or was declined here', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);
  useCallStore.getState().resetCallState();

  useCallStore.getState().handleCallInvite(invite);
  assert.equal(useCallStore.getState().incomingCall, null);

  useCallStore.getState().handleCallEnded({
    callId: 'call-9',
    status: 'CANCELED',
    endReason: 'CANCELED',
    endedAt: '2026-06-11T03:00:20.000Z',
    changedAt: '2026-06-11T03:00:20.000Z',
  });
  // 撤销先到、邀请后到（推送不保证顺序）。
  useCallStore.getState().handleCallInvite({ ...invite, callId: 'call-9' });
  assert.equal(useCallStore.getState().incomingCall, null);
});

test('does not replace a call this device already joined with a late invite', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);
  useCallStore.getState().setActiveCall({
    ...useCallStore.getState().activeCall!,
    status: 'ACTIVE',
  });

  useCallStore.getState().handleCallInvite(invite);

  assert.equal(useCallStore.getState().incomingCall, null);
  assert.equal(useCallStore.getState().activeCall?.status, 'ACTIVE');
});

test('stops ringing when this user answered on another device', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);

  useCallStore.getState().handleSelfParticipantSettled('call-1', 'answered_elsewhere');

  assert.equal(useCallStore.getState().incomingCall, null);
  assert.equal(useCallStore.getState().activeCall, null);
  assert.deepEqual(useCallStore.getState().lastDismissal, {
    callId: 'call-1',
    reason: 'answered_elsewhere',
    invitationCreatedAt: invite.createdAt,
  });
  useCallStore.getState().handleCallInvite(invite);
  assert.equal(useCallStore.getState().incomingCall, null);
});

test('keeps ringing UI while this device is the one answering', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);
  useCallStore.getState().setAnsweringCallId('call-1');

  // 本机 accept 还在路上，WS 先送到了「本人已加入」。
  useCallStore.getState().handleSelfParticipantSettled('call-1', 'answered_elsewhere');

  assert.equal(useCallStore.getState().incomingCall?.callId, 'call-1');
});

test('dismisses only the ringing call it was asked to', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);

  useCallStore.getState().dismissIncomingCall('call-other', 'missed');
  assert.equal(useCallStore.getState().incomingCall?.callId, 'call-1');

  useCallStore.getState().dismissIncomingCall('call-1', 'missed');
  assert.equal(useCallStore.getState().incomingCall, null);
  assert.equal(useCallStore.getState().activeCall, null);
  assert.deepEqual(useCallStore.getState().lastDismissal, {
    callId: 'call-1',
    reason: 'missed',
    invitationCreatedAt: invite.createdAt,
  });
});

test('reports why the active call ended', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);

  useCallStore.getState().handleCallEnded({
    callId: 'call-1',
    status: 'CANCELED',
    endReason: 'CANCELED',
    endedAt: '2026-06-11T03:00:20.000Z',
    changedAt: '2026-06-11T03:00:20.000Z',
  });

  assert.deepEqual(useCallStore.getState().lastDismissal, {
    callId: 'call-1',
    reason: 'canceled',
    invitationCreatedAt: invite.createdAt,
  });
});

test('does not tear down the call this device is answering', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);
  useCallStore.getState().setAnsweringCallId('call-1');

  // accept 已提交：对账说「不再邀请你」、撤销推送说「已在其他设备接听」—— 说的都是本机。
  useCallStore.getState().dismissIncomingCall('call-1', 'ended');
  useCallStore.getState().dismissIncomingCall('call-1', 'answered_elsewhere');
  assert.equal(useCallStore.getState().incomingCall?.callId, 'call-1');

  // 只有接听本身失败才收。
  useCallStore.getState().dismissIncomingCall('call-1', 'failed');
  assert.equal(useCallStore.getState().incomingCall, null);
});

test('flags a ringing call the system call UI could not take', () => {
  resetStore();
  useCallStore.getState().setNativeUiFallback('call-1');
  assert.equal(useCallStore.getState().nativeUiFallbackCallId, null);

  useCallStore.getState().handleCallInvite(invite);
  useCallStore.getState().setNativeUiFallback('call-1');
  assert.equal(useCallStore.getState().nativeUiFallbackCallId, 'call-1');
});

test('a fresh invitation into the same room rings after a previous attempt was dismissed', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);
  useCallStore.getState().dismissIncomingCall(invite.callId, 'missed');
  useCallStore.getState().handleCallInvite(invite);
  assert.equal(useCallStore.getState().incomingCall, null);
  const later = { ...invite, createdAt: '2026-06-11T03:01:00.000Z', expiresAt: '2026-06-11T03:01:45.000Z' };
  useCallStore.getState().handleCallInvite(later);
  assert.equal(useCallStore.getState().incomingCall?.createdAt, later.createdAt);
});

test('a call roster update preserves room credentials, minimization, and newer joined events', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);
  const call = { ...useCallStore.getState().activeCall!, status: 'ACTIVE' as const };
  const credentials = { url: 'wss://example.test', token: 'room-token', expiresAt: '' };
  useCallStore.getState().setActiveCall(call, credentials);
  useCallStore.getState().setMinimized(true);
  useCallStore.getState().handleCallParticipantJoined({
    callId: call.id, user: invite.invitees[0], joinedAt: '2026-06-11T03:00:20.000Z', changedAt: '2026-06-11T03:00:20.000Z',
  });
  useCallStore.getState().updateActiveCall({ ...call, invitationMode: 'contacts' });
  assert.equal(useCallStore.getState().livekit, credentials);
  assert.equal(useCallStore.getState().isMinimized, true);
  assert.equal(useCallStore.getState().activeCall?.participants[1].status, 'JOINED');
  useCallStore.getState().updateActiveCall({ ...call, id: 'different' });
  assert.equal(useCallStore.getState().activeCall?.id, call.id);
});

test('accepting a call retains this devices invitation generation when other people were invited later', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);
  const call = useCallStore.getState().activeCall!;
  useCallStore.getState().setActiveCall({
    ...call,
    status: 'ACTIVE',
    participants: [...call.participants, {
      user: { id: 'later', nickname: 'Later', avatarUrl: null },
      status: 'INVITED', invitedAt: '2026-06-11T03:00:20.000Z', joinedAt: null, leftAt: null,
    }],
  });
  assert.equal(useCallStore.getState().inviteGenerations[invite.callId], Date.parse(invite.createdAt));
});

test('a delayed rejection of the previous generation cannot dismiss a fresh ringing invitation', () => {
  resetStore();
  useCallStore.getState().handleCallInvite(invite);
  const fresh = { ...invite, createdAt: '2026-06-11T03:01:00.000Z', expiresAt: '2026-06-11T03:01:45.000Z' };
  useCallStore.getState().handleCallInvite(fresh);
  const rejectedAt = '2026-06-11T03:00:08.000Z';
  useCallStore.getState().handleCallParticipantRejected({
    callId: invite.callId, user: invite.invitees[0], changedAt: rejectedAt,
  });
  useCallStore.getState().handleSelfParticipantSettled(invite.callId, 'declined_elsewhere', rejectedAt);
  assert.equal(useCallStore.getState().incomingCall?.createdAt, fresh.createdAt);
  assert.equal(useCallStore.getState().activeCall?.participants[1].status, 'INVITED');
});
