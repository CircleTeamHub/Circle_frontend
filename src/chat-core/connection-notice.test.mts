import test from 'node:test';
import assert from 'node:assert/strict';
import { getChatConnectionNotice } from './connection-notice.ts';

const signedIn = { currentUserId: 'u-1', connected: false };

test('getChatConnectionNotice: quiet until a handshake has actually failed', () => {
  assert.equal(getChatConnectionNotice({ ...signedIn, error: null }), null);
  assert.equal(
    getChatConnectionNotice({ ...signedIn, connected: true, error: null }),
    null,
  );
});

test('getChatConnectionNotice: quiet when nobody is signed in', () => {
  assert.equal(
    getChatConnectionNotice({ currentUserId: null, connected: false, error: 'timeout' }),
    null,
  );
});

test('getChatConnectionNotice: transport failures mean the server cannot be reached', () => {
  for (const error of ['timeout', 'transport_error', 'network_error']) {
    assert.equal(getChatConnectionNotice({ ...signedIn, error }), 'unreachable', error);
  }
});

test('getChatConnectionNotice: the server answered but refused for a non-auth reason', () => {
  for (const error of ['server_error', 'rate_limited', 'not_found', 'unknown']) {
    assert.equal(getChatConnectionNotice({ ...signedIn, error }), 'server_error', error);
  }
});

test('getChatConnectionNotice: auth rejections go through token refresh or sign-out, not a banner', () => {
  for (const error of ['unauthorized', 'forbidden']) {
    assert.equal(getChatConnectionNotice({ ...signedIn, error }), null, error);
  }
});

test('getChatConnectionNotice: a stale error never outlives a live connection', () => {
  assert.equal(
    getChatConnectionNotice({ ...signedIn, connected: true, error: 'timeout' }),
    null,
  );
});
