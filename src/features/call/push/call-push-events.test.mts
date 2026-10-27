import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dismissReasonFromNative,
  inviteFromCurrentCall,
  notifyVoipTokenChanged,
  parseCallPushEvent,
  subscribeVoipTokenChanges,
} from './call-push-events.ts';

const now = Date.parse('2026-10-26T12:00:10.000Z');
const alice = { id: 'user-1', nickname: 'Alice', avatarUrl: null };
const bob = { id: 'user-2', nickname: 'Bob', avatarUrl: null };

function current(overrides: Record<string, unknown> = {}, selfStatus = 'INVITED') {
  return {
    call: {
      id: 'call-1',
      conversationID: 'direct:user-1:user-2',
      sessionType: 'single' as const,
      callType: 'VIDEO' as const,
      status: 'RINGING' as const,
      initiator: alice,
      startedAt: null,
      endedAt: null,
      expiresAt: '2026-10-26T12:00:45.000Z',
      durationSeconds: null,
      endReason: null,
      participants: [
        { user: alice, status: 'JOINED' as const, invitedAt: '2026-10-26T12:00:00.000Z', joinedAt: null, leftAt: null },
        { user: bob, status: 'INVITED' as const, invitedAt: '2026-10-26T12:00:00.000Z', joinedAt: null, leftAt: null },
      ],
      ...overrides,
    },
    selfParticipant: {
      user: bob,
      status: selfStatus as 'INVITED',
      invitedAt: '2026-10-26T12:00:00.000Z',
      joinedAt: null,
      leftAt: null,
    },
  };
}

test('parses every event the native layer queues', () => {
  assert.deepEqual(parseCallPushEvent({ type: 'voipToken' }), { type: 'voipToken' });
  for (const type of ['unavailable', 'answer', 'hangup']) {
    assert.deepEqual(parseCallPushEvent({ type, callId: 'c1' }), { type, callId: 'c1' });
  }
  assert.deepEqual(parseCallPushEvent({ type: 'incoming', callId: 'c1', shown: false }), {
    type: 'incoming',
    callId: 'c1',
    shown: false,
  });
  // 旧版本原生层不带 shown：当作响了。
  assert.deepEqual(parseCallPushEvent({ type: 'incoming', callId: 'c1' }), {
    type: 'incoming',
    callId: 'c1',
    shown: true,
  });
  assert.deepEqual(
    parseCallPushEvent({ type: 'decline', callId: 'c1', declinedByNative: true }),
    { type: 'decline', callId: 'c1', declinedByNative: true },
  );
  assert.deepEqual(parseCallPushEvent({ type: 'end', callId: 'c1', reason: 'missed' }), {
    type: 'end',
    callId: 'c1',
    reason: 'missed',
  });
});

test('treats anything unexpected from the native layer as no event', () => {
  for (const raw of [null, 'x', 1, {}, { type: 'answer' }, { type: 'answer', callId: '' }, { type: 'later', callId: 'c1' }]) {
    assert.equal(parseCallPushEvent(raw), null);
  }
  // 只有明确的 true 才算原生层已经告诉过服务端：否则 JS 自己再调一次 reject。
  assert.deepEqual(parseCallPushEvent({ type: 'decline', callId: 'c1', declinedByNative: 'yes' }), {
    type: 'decline',
    callId: 'c1',
    declinedByNative: false,
  });
  assert.deepEqual(parseCallPushEvent({ type: 'end', callId: 'c1' }), {
    type: 'end',
    callId: 'c1',
    reason: 'ended',
  });
});

test('maps native and server dismiss reasons onto the store reasons', () => {
  assert.equal(dismissReasonFromNative('answered_elsewhere'), 'answered_elsewhere');
  assert.equal(dismissReasonFromNative('canceled'), 'canceled');
  assert.equal(dismissReasonFromNative('reset'), 'ended');
});

test('rebuilds the invite for a call that still rings for me', () => {
  const invite = inviteFromCurrentCall(current(), now);

  assert.deepEqual(invite, {
    callId: 'call-1',
    conversationID: 'direct:user-1:user-2',
    sessionType: 'single',
    callType: 'VIDEO',
    initiator: alice,
    invitees: [bob],
    expiresAt: '2026-10-26T12:00:45.000Z',
    createdAt: '2026-10-26T12:00:00.000Z',
  });
});

test('does not rebuild an invite once I answered, declined, or the ring window closed', () => {
  assert.equal(inviteFromCurrentCall(null, now), null);
  assert.equal(inviteFromCurrentCall(current({}, 'JOINED'), now), null);
  assert.equal(inviteFromCurrentCall(current({}, 'REJECTED'), now), null);
  assert.equal(inviteFromCurrentCall(current({ status: 'ENDED' }), now), null);
  assert.equal(inviteFromCurrentCall(current({ expiresAt: '2026-10-26T12:00:05.000Z' }), now), null);
  assert.equal(inviteFromCurrentCall(current({ expiresAt: null }), now), null);
});

test('still rebuilds an invite for a group call that went active without me', () => {
  assert.equal(inviteFromCurrentCall(current({ status: 'ACTIVE', sessionType: 'group' }), now)?.callId, 'call-1');
});

test('fans VoIP token changes out to subscribers until they unsubscribe', () => {
  let calls = 0;
  const unsubscribe = subscribeVoipTokenChanges(() => {
    calls += 1;
  });
  notifyVoipTokenChanged();
  unsubscribe();
  notifyVoipTokenChanged();
  assert.equal(calls, 1);
});
