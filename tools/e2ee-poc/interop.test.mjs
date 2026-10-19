import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { nobleCryptoProvider, getCiphersuiteImpl, getCiphersuiteFromName } from 'ts-mls';
import { EncryptedJournal } from './journal.mjs';
import { ProtocolDevice } from './protocol.mjs';
import { portableCryptoProvider } from './portable-provider.mjs';

test('portable and default WebCrypto implementations exchange MLS messages and rekey', async t => {
  const pins = new Map();
  const journalA = new EncryptedJournal(':memory:', randomBytes(32), 'portable');
  const journalB = new EncryptedJournal(':memory:', randomBytes(32), 'webcrypto');
  t.after(() => { journalA.close(); journalB.close(); });
  const alice = await ProtocolDevice.open(journalA, 'alice', 'portable', pins);
  const bob = await ProtocolDevice.open(journalB, 'bob', 'webcrypto', pins, nobleCryptoProvider);
  for (const device of [alice, bob]) pins.set(device.deviceId, device.publicIdentity());
  await alice.create('interop');
  const addition = await alice.changeMembers('interop', 'add', { add: [await bob.publishKeyPackage()] });
  await bob.join('interop', 'portable', addition.welcome);
  assert.deepEqual(await bob.receive(await alice.send('interop', 'm1', { text: 'portable to webcrypto' })), { text: 'portable to webcrypto' });
  assert.deepEqual(await alice.receive(await bob.send('interop', 'm2', { text: 'webcrypto to portable' })), { text: 'webcrypto to portable' });
  const rekey = await alice.changeMembers('interop', 'update');
  await bob.receiveCommit('interop', rekey.commit);
  assert.deepEqual(await bob.receive(await alice.send('interop', 'm3', { text: 'next epoch' })), { text: 'next epoch' });
});

test('unsupported ciphersuites fail rather than silently selecting a weaker suite', async () => {
  await assert.rejects(getCiphersuiteImpl(getCiphersuiteFromName('MLS_256_DHKEMX448_AES256GCM_SHA512_Ed448'), portableCryptoProvider), /Unsupported/);
});

test('missing OS secure random generator fails closed before generating keys', () => {
  const script = `
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const { portableCryptoProvider } = await import('./portable-provider.mjs');
    const { getCiphersuiteImpl, getCiphersuiteFromName } = await import('ts-mls');
    try {
      await getCiphersuiteImpl(getCiphersuiteFromName('MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519'), portableCryptoProvider);
      process.exitCode = 2;
    } catch (e) {
      if (!/secure random generator/.test(e.message)) throw e;
      process.stdout.write('SECURE_RANDOM_REQUIRED');
    }
  `;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('.', import.meta.url), encoding: 'utf8' }), 'SECURE_RANDOM_REQUIRED');
});
