import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ProtocolDevice } from './protocol.mjs';
import { EncryptedJournal } from './journal.mjs';
import { encryptAttachment, decryptAttachment } from './attachment.mjs';
import { createCommit, encodeMlsMessage } from 'ts-mls';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'circle-mls-test-'));
  const pins = new Map(), handles = new Set();
  const material = new Map();
  async function open(userId, deviceId, approve = true) {
    const key = material.get(deviceId) ?? randomBytes(32);
    material.set(deviceId, key);
    const journal = new EncryptedJournal(join(directory, `${deviceId}.sqlite`), key, deviceId);
    handles.add(journal);
    const device = await ProtocolDevice.open(journal, userId, deviceId, pins);
    if (approve) pins.set(deviceId, device.publicIdentity());
    return device;
  }
  function close(device) { device.journal.close(); handles.delete(device.journal); }
  t.after(() => { for (const h of handles) h.close(); rmSync(directory, { recursive: true, force: true }); });
  const alice = await open('alice', 'alice-phone'), bob = await open('bob', 'bob-phone');
  await alice.create('chat-1');
  const invitation = await alice.changeMembers('chat-1', 'add-bob', { add: [await bob.publishKeyPackage()] });
  await bob.join('chat-1', 'alice-phone', invitation.welcome);
  return { directory, pins, material, open, close, alice, bob };
}

test('offline delivery, bidirectional messages and out-of-order delivery use real MLS', async t => {
  const { alice, bob } = await fixture(t);
  const first = await alice.send('chat-1', 'msg-1', { text: 'offline secret 一' });
  const second = await alice.send('chat-1', 'msg-2', { text: 'offline secret 二' });
  assert.equal(JSON.stringify(first).includes('offline secret'), false);
  assert.deepEqual(await bob.receive(second), { text: 'offline secret 二' });
  assert.deepEqual(await bob.receive(first), { text: 'offline secret 一' });
  await assert.rejects(bob.receive(first), /already received/);
  assert.deepEqual(await alice.receive(await bob.send('chat-1', 'reply-1', { text: 'reply' })), { text: 'reply' });
});

test('ciphertext tampering and envelope substitution fail without consuming the valid message', async t => {
  const { alice, bob } = await fixture(t);
  const packet = await alice.send('chat-1', 'msg-1', { text: 'private' });
  for (const [key, value] of Object.entries({ protocol: 'plain', version: 2, epoch: '999', senderDeviceId: 'bob-phone', clientMessageId: 'forged', conversationId: 'wrong' })) {
    await assert.rejects(bob.receive({ ...packet, [key]: value }));
  }
  const mutated = Buffer.from(packet.ciphertext, 'base64'); mutated[mutated.length - 1] ^= 1;
  await assert.rejects(bob.receive({ ...packet, ciphertext: mutated.toString('base64') }));
  await assert.rejects(bob.receive({ ...packet, ciphertext: Buffer.concat([Buffer.from(packet.ciphertext, 'base64'), Buffer.from([0])]).toString('base64') }));
  assert.deepEqual(await bob.receive(packet), { text: 'private' });
});

test('new devices cannot read old messages; removed devices cannot read subsequent epochs', async t => {
  const { alice, bob, open } = await fixture(t);
  const before = await alice.send('chat-1', 'before-add', { text: 'before new device' });
  const laptop = await open('alice', 'alice-laptop');
  const addition = await alice.changeMembers('chat-1', 'add-laptop', { add: [await laptop.publishKeyPackage()] });
  await bob.receiveCommit('chat-1', addition.commit);
  await laptop.join('chat-1', 'alice-phone', addition.welcome);
  await assert.rejects(laptop.receive(before));
  assert.deepEqual(await bob.receive(before), { text: 'before new device' });
  const current = await alice.send('chat-1', 'after-add', { text: 'multi-device' });
  assert.deepEqual(await bob.receive(current), { text: 'multi-device' });
  assert.deepEqual(await laptop.receive(current), { text: 'multi-device' });
  const removal = await alice.changeMembers('chat-1', 'remove-bob', { remove: ['bob-phone'] });
  await laptop.receiveCommit('chat-1', removal.commit);
  // The removal itself is encrypted under the old epoch and informs Bob that
  // his membership ended. It must not give him the next epoch's message keys.
  await bob.receiveCommit('chat-1', removal.commit);
  await assert.rejects(bob.send('chat-1', 'revoked-send', { text: 'not allowed' }));
  const future = await alice.send('chat-1', 'after-remove', { text: 'revoked device excluded' });
  await assert.rejects(bob.receive(future));
  assert.deepEqual(await laptop.receive(future), { text: 'revoked device excluded' });
});

test('unapproved device keys, replaced keys and forged invitations are rejected', async t => {
  const { alice, bob, open, pins } = await fixture(t);
  const stranger = await open('mallory', 'mallory-phone', false);
  const keyPackage = await stranger.publishKeyPackage();
  await assert.rejects(alice.changeMembers('chat-1', 'unapproved', { add: [keyPackage] }), /Unapproved/);
  const laptop = await open('alice', 'alice-laptop');
  const addition = await alice.changeMembers('chat-1', 'add-laptop', { add: [await laptop.publishKeyPackage()] });
  await assert.rejects(laptop.join('different-chat', 'alice-phone', addition.welcome), /Unapproved group invitation/);
  await assert.rejects(laptop.join('chat-1', 'bob-phone', addition.welcome), /Unapproved group invitation/);
  await assert.rejects(laptop.join('chat-1', 'alice-phone', { ...addition.welcome, signature: Buffer.alloc(64).toString('base64') }));
  await laptop.join('chat-1', 'alice-phone', addition.welcome);
  await assert.rejects(laptop.join('chat-1', 'alice-phone', addition.welcome), /existing group/);
  pins.set('mallory-phone', { ...stranger.publicIdentity(), publicKey: bob.publicIdentity().publicKey });
  await assert.rejects(alice.changeMembers('chat-1', 'substituted-key', { add: [keyPackage] }), /Unapproved/);
  await assert.rejects(bob.changeMembers('chat-1', 'unauthorized-manager'), /Only the pinned manager/);
});

test('restart preserves byte-identical retries and durable inbox; conflicting reuse is rejected', async t => {
  const { alice, bob, open, close } = await fixture(t);
  const packet = await alice.send('chat-1', 'durable-message', { text: 'survives restart' });
  close(alice);
  const restoredAlice = await open('alice', 'alice-phone');
  assert.deepEqual(await restoredAlice.send('chat-1', 'durable-message', { text: 'survives restart' }), packet);
  await assert.rejects(restoredAlice.send('chat-1', 'durable-message', { text: 'changed' }), /Idempotency/);
  await bob.receive(packet);
  close(bob);
  const restoredBob = await open('bob', 'bob-phone');
  assert.equal((await restoredBob.messages())[0].body.text, 'survives restart');
  await assert.rejects(restoredBob.receive(packet), /already received/);
  const next = await restoredAlice.send('chat-1', 'next-message', { text: 'next generation' });
  assert.deepEqual(await restoredBob.receive(next), { text: 'next generation' });
});

test('transaction failure exposes no ciphertext, rolls back ratchets and inbox, then retries safely', async t => {
  const { alice, bob } = await fixture(t);
  const before = alice.journal.load();
  const crash = () => { throw new Error('injected disk failure'); };
  await assert.rejects(alice.send('chat-1', 'atomic-msg', { text: 'atomic' }, crash), /disk failure/);
  assert.deepEqual(alice.journal.load(), before);
  const packet = await alice.send('chat-1', 'atomic-msg', { text: 'atomic' });
  const bobBefore = bob.journal.load();
  await assert.rejects(bob.receive(packet, crash), /disk failure/);
  assert.deepEqual(bob.journal.load(), bobBefore);
  assert.deepEqual(await bob.receive(packet), { text: 'atomic' });
});

test('two concurrent senders sharing device state cannot reuse the same ratchet generation', async t => {
  const { alice, bob, open } = await fixture(t);
  const duplicate = await open('alice', 'alice-phone');
  const results = await Promise.allSettled([
    alice.send('chat-1', 'concurrent-a', { text: 'a' }),
    duplicate.send('chat-1', 'concurrent-b', { text: 'b' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /Concurrent state/);
  const winner = results.find(r => r.status === 'fulfilled').value;
  assert.ok(['a', 'b'].includes((await bob.receive(winner)).text));
});

test('state, private keys and inbox plaintext stay encrypted on disk; wrong storage key fails', async t => {
  const { alice, bob, directory } = await fixture(t);
  const secret = 'distinct-sensitive-message-8891';
  const privateKey = alice.journal.load().record.signing.signKey;
  await bob.receive(await alice.send('chat-1', 'encrypted-disk', { text: secret }));
  for (const file of readdirSync(directory)) {
    const raw = readFileSync(join(directory, file));
    assert.equal(raw.includes(Buffer.from(secret)), false, file);
    assert.equal(raw.includes(Buffer.from(privateKey)), false, file);
  }
  const wrong = new EncryptedJournal(join(directory, 'alice-phone.sqlite'), randomBytes(32), 'alice-phone');
  try { assert.throws(() => wrong.load()); } finally { wrong.close(); }
});

test('media encryption hides keys inside MLS and rejects tampered, truncated or swapped objects', async t => {
  const { alice, bob } = await fixture(t);
  const source = new TextEncoder().encode('private image fixture');
  const { ciphertext, reference } = encryptAttachment(source, 'chat-1');
  assert.equal(Buffer.from(ciphertext).includes(Buffer.from(source)), false);
  const packet = await alice.send('chat-1', 'photo-1', { attachment: reference });
  assert.equal(JSON.stringify(packet).includes(reference.key), false);
  const received = await bob.receive(packet);
  assert.deepEqual(decryptAttachment(ciphertext, received.attachment, 'chat-1'), source);
  const corrupt = ciphertext.slice(); corrupt[0] ^= 1;
  assert.throws(() => decryptAttachment(corrupt, reference, 'chat-1'));
  assert.throws(() => decryptAttachment(ciphertext.subarray(1), reference, 'chat-1'));
  assert.throws(() => decryptAttachment(ciphertext, reference, 'other-chat'));
  assert.throws(() => decryptAttachment(ciphertext, { ...reference, objectId: 'swapped' }, 'chat-1'));
});

test('reserved identifiers are rejected before journal or object-property access', async t => {
  const { alice } = await fixture(t);
  for (const id of ['__proto__', 'constructor', 'toString']) {
    await assert.rejects(alice.create(id), /Invalid identifier/);
    await assert.rejects(alice.send('chat-1', id, {}), /Invalid identifier/);
  }
});

test('a real MLS commit signed by a non-manager is rejected without advancing the epoch', async t => {
  const { alice, bob } = await fixture(t);
  const before = alice.journal.load();
  // Bypass the application API, as a modified client would.
  const state = bob.state(bob.journal.load().record, 'chat-1');
  const forged = await createCommit({ state, cipherSuite: bob.impl });
  await assert.rejects(alice.receiveCommit('chat-1', Buffer.from(encodeMlsMessage(forged.commit)).toString('base64')), /Unauthorized membership change/);
  assert.deepEqual(alice.journal.load(), before);
});

test('membership changes and Welcome are atomically persisted and retry without rekeying', async t => {
  const { alice, bob, open, close } = await fixture(t);
  const laptop = await open('alice', 'alice-laptop');
  const addition = { add: [await laptop.publishKeyPackage()] };
  const before = alice.journal.load();
  await assert.rejects(alice.changeMembers('chat-1', 'atomic-add', addition, () => { throw new Error('disk failure'); }), /disk failure/);
  assert.deepEqual(alice.journal.load(), before);
  const packet = await alice.changeMembers('chat-1', 'atomic-add', addition);
  close(alice);
  const restored = await open('alice', 'alice-phone');
  assert.deepEqual(await restored.changeMembers('chat-1', 'atomic-add', addition), packet);
  await bob.receiveCommit('chat-1', packet.commit);
  await laptop.join('chat-1', 'alice-phone', packet.welcome);
  assert.deepEqual(await laptop.receive(await restored.send('chat-1', 'new-epoch-message', { text: 'restored epoch' })), { text: 'restored epoch' });
});

test('32 devices share a group and a batch removal excludes all removed leaves', async t => {
  const { alice, bob, open } = await fixture(t);
  const devices = [];
  for (let i = 0; i < 30; i++) devices.push(await open(`user-${i}`, `device-${i}`));
  const packages = await Promise.all(devices.map(d => d.publishKeyPackage()));
  const add = await alice.changeMembers('chat-1', 'large-add', { add: packages });
  await bob.receiveCommit('chat-1', add.commit);
  await Promise.all(devices.map(d => d.join('chat-1', 'alice-phone', add.welcome)));
  const first = await alice.send('chat-1', 'group-message', { text: '32 devices' });
  for (const d of [bob, ...devices]) assert.deepEqual(await d.receive(first), { text: '32 devices' });
  const removed = devices.filter((_, i) => i % 2 === 0);
  const kept = devices.filter((_, i) => i % 2 === 1);
  const change = await alice.changeMembers('chat-1', 'large-remove', { remove: removed.map(d => d.deviceId) });
  for (const d of [bob, ...devices]) await d.receiveCommit('chat-1', change.commit);
  const next = await alice.send('chat-1', 'survivors-only', { text: 'remaining 17 devices' });
  for (const d of removed) await assert.rejects(d.receive(next));
  for (const d of [bob, ...kept]) assert.deepEqual(await d.receive(next), { text: 'remaining 17 devices' });
});

test('React Native without WebCrypto fails closed: Noble provider alone does not supply X25519', () => {
  const script = `
    import { webcrypto } from 'node:crypto';
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, configurable: true });
    const m = await import('ts-mls');
    const cs = await m.getCiphersuiteImpl(m.getCiphersuiteFromName('MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519'), m.nobleCryptoProvider);
    try {
      await m.generateKeyPackage({ credentialType: 'basic', identity: new Uint8Array([1]) }, m.defaultCapabilities(), m.defaultLifetime, [], cs);
      process.exitCode = 2;
    } catch (error) {
      if (!/generateKey|SubtleCrypto|subtle/.test(error.message)) throw error;
      process.stdout.write('NATIVE_CRYPTO_ADAPTER_REQUIRED');
    }
  `;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('.', import.meta.url), encoding: 'utf8' }), 'NATIVE_CRYPTO_ADAPTER_REQUIRED');
});
