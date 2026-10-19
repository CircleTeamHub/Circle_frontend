import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryCode, openRecoveryKey } from '@circle/e2ee/recovery.mjs';
import { verifyDeviceProof } from './test-support/recovery-proof.mjs';

test('recovery code validates checksum, separates account/purpose and authenticates archive context', async () => {
  const code = createRecoveryCode();
  const key = openRecoveryKey(code, 'alice', 'APP');
  const copy = openRecoveryKey(code.toUpperCase(), 'alice', 'APP');
  const other = openRecoveryKey(code, 'bob', 'APP');
  const admin = openRecoveryKey(code, 'alice', 'AUDIT');
  assert.equal(key.publicKey, copy.publicKey);
  assert.notEqual(key.publicKey, other.publicKey);
  assert.notEqual(key.publicKey, admin.publicKey);
  assert.throws(() => openRecoveryKey(code.slice(0, -1) + (code.endsWith('0') ? '1' : '0'), 'alice', 'APP'), /checksum/);
  const ref = ['conversation', 'device', 'message'];
  const clear = { text: 'private history' };
  const sealed = key.seal('recovery-id', ref, clear);
  assert.deepEqual(copy.open('recovery-id', ref, sealed), clear);
  assert.throws(() => other.open('recovery-id', ref, sealed));
  assert.throws(() => key.open('different', ref, sealed));
  assert.throws(() => key.open('recovery-id', ['other', ...ref.slice(1)], sealed));
  const signature = key.sign('recover', ['alice', 'new-device']);
  assert.equal(verifyDeviceProof(key.publicKey, 'recover', ['alice', 'new-device'], signature), true);
  assert.equal(verifyDeviceProof(key.publicKey, 'recover', ['alice', 'attacker-device'], signature), false);
  key.close();
  assert.throws(() => key.sign('recover', []), /locked/);
  for (const value of [copy, other, admin]) value.close();
});
