import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCallInvitePayload,
  isCallParticipantPayload,
} from './realtime-guards.ts';

const user = { id: 'user-1', nickname: 'Alice', avatarUrl: null };

test('accepts a complete call invite payload', () => {
  assert.equal(
    isCallInvitePayload({
      callId: 'call-1',
      conversationID: 'sg_group-1',
      sessionType: 'group',
      callType: 'AUDIO',
      initiator: user,
      invitees: [{ id: 'user-2', nickname: 'Bob', avatarUrl: null }],
      expiresAt: '2026-06-11T03:00:45.000Z',
      createdAt: '2026-06-11T03:00:00.000Z',
    }),
    true,
  );
});

test('rejects call invites with a null initiator', () => {
  assert.equal(
    isCallInvitePayload({
      callId: 'call-1',
      conversationID: 'sg_group-1',
      sessionType: 'group',
      callType: 'AUDIO',
      initiator: null,
      invitees: [],
      expiresAt: '2026-06-11T03:00:45.000Z',
      createdAt: '2026-06-11T03:00:00.000Z',
    }),
    false,
  );
});

test('rejects call invites with malformed invitees', () => {
  assert.equal(
    isCallInvitePayload({
      callId: 'call-1',
      conversationID: 'sg_group-1',
      sessionType: 'group',
      callType: 'AUDIO',
      initiator: user,
      invitees: [{ id: 'user-2', nickname: null, avatarUrl: null }],
      expiresAt: '2026-06-11T03:00:45.000Z',
      createdAt: '2026-06-11T03:00:00.000Z',
    }),
    false,
  );
});

test('rejects participant updates with malformed users', () => {
  assert.equal(
    isCallParticipantPayload({
      callId: 'call-1',
      user: { id: 'user-2' },
      changedAt: '2026-06-11T03:00:10.000Z',
    }),
    false,
  );
});
