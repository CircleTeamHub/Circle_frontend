const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const call = {
  id: 'call-1', conversationID: 'conference:call-1', sessionType: 'group',
  invitationMode: 'contacts', callType: 'AUDIO', status: 'ACTIVE',
  initiator: { id: 'alice', nickname: 'Alice', avatarUrl: null },
  startedAt: null, endedAt: null, expiresAt: null, durationSeconds: null,
  endReason: null, participants: [],
};

function loadCallApi(response) {
  const requests = [];
  const api = loadTsModule('src/services/api/calls.ts', {
    requireShim: (request) => request === './client' ? {
      apiClient: async (path, options) => {
        requests.push([path, options]);
        return response;
      },
    } : require(request),
  });
  return { api, requests };
}

test('invites into the current call with an intent key and returns the normalized session without credentials', async () => {
  const { api, requests } = loadCallApi({ call });

  const result = await api.inviteCallParticipants('call-1', ['bob'], { idempotencyKey: 'invite-key' });

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [[
    '/calls/call-1/invite', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'invite-key' },
      body: { inviteeIDs: ['bob'] },
    },
  ]]);
  assert.equal(result.id, 'call-1');
  assert.equal(result.invitationMode, 'contacts');
  assert.equal(result.livekit, undefined);
});

test('authenticated call actions send the displayed invitation generation when known', async () => {
  const { api, requests } = loadCallApi({
    call, selfParticipant: null, livekit: { url: 'wss://livekit.test', token: 'token', expiresAt: '2026-11-10T19:00:00.000Z' },
  });
  const createdAt = '2026-11-10T18:00:00.000Z';
  const expectedHeaders = { 'X-Call-Invite-Created-At': createdAt };

  await api.acceptCall('call-1', createdAt);
  await api.rejectCall('call-1', createdAt);
  await api.rejectCall('call-1');

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    ['/calls/call-1/accept', { method: 'POST', headers: expectedHeaders }],
    ['/calls/call-1/reject', { method: 'POST', headers: expectedHeaders }],
    ['/calls/call-1/reject', { method: 'POST' }],
  ]);
});
