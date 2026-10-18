import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ProtocolDevice } from './protocol.mjs';
import { sealJournal, openJournal } from '@circle/e2ee/journal-codec.mjs';

function journal() {
  let value = { revision: 0, record: null };
  return {
    async load() { return structuredClone(value); },
    async save(revision, record) {
      // Make the adapter genuinely asynchronous: missing await used to expose
      // uncommitted protocol state when adapting the synchronous Node lab.
      await Promise.resolve();
      if (revision !== value.revision) throw new Error('Concurrent state change');
      value = { revision: revision + 1, record: structuredClone(record) };
    },
  };
}

test('portable encrypted journal authenticates account, device, revision and ciphertext', () => {
  const key = randomBytes(32);
  const record = { privateKey: 'test-secret', text: 'private content' };
  const sealed = sealJournal(key, 'alice:phone', 1, record);
  assert.equal(new TextDecoder().decode(sealed).includes('private content'), false);
  assert.deepEqual(openJournal(key, 'alice:phone', 1, sealed), record);
  assert.throws(() => openJournal(key, 'bob:phone', 1, sealed));
  assert.throws(() => openJournal(key, 'alice:phone', 2, sealed));
  assert.throws(() => openJournal(randomBytes(32), 'alice:phone', 1, sealed));
  sealed[20] ^= 1;
  assert.throws(() => openJournal(key, 'alice:phone', 1, sealed));
});

test('async journal persists confirmed device identities; opening a device never approves it for peers', async () => {
  const storage = journal();
  const pins = new Map();
  const alice = await ProtocolDevice.open(storage, 'alice', 'phone', pins);
  assert.equal(pins.has('phone'), false);
  await alice.confirmIdentity(alice.publicIdentity());
  const restored = await ProtocolDevice.open(storage, 'alice', 'phone', new Map());
  assert.deepEqual(restored.pins.get('phone'), alice.publicIdentity());
  const replaced = await ProtocolDevice.open(journal(), 'alice', 'replacement', new Map());
  await assert.rejects(restored.confirmIdentity({ ...replaced.publicIdentity(), deviceId: 'phone' }), /key changed/);
});

test('device approval proof binds action, target account and exact key', async () => {
  const alice = await ProtocolDevice.open(journal(), 'alice', 'phone', new Map());
  const payload = ['alice', 'laptop', 'new-public-key'];
  const signature = await alice.signPayload('approve', payload);
  assert.equal(await alice.verifyPayload(alice.publicIdentity(), 'approve', payload, signature), true);
  assert.equal(await alice.verifyPayload(alice.publicIdentity(), 'revoke', payload, signature), false);
  assert.equal(await alice.verifyPayload(alice.publicIdentity(), 'approve', ['bob', 'laptop', 'new-public-key'], signature), false);
  assert.equal(await alice.verifyPayload(alice.publicIdentity(), 'approve', ['alice', 'laptop', 'replaced-key'], signature), false);
});
