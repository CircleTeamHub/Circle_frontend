import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ProtocolDevice } from './protocol.mjs';
import { EncryptedJournal } from './journal.mjs';

// Synthetic desktop baseline, including the current durable journal. Never use
// these figures as Hermes/device FPS, battery, network, or production capacity.
const directory = mkdtempSync(join(tmpdir(), 'circle-mls-benchmark-'));
const journals = [];
const pins = new Map();
const results = {};
const percentile = (values, p) => Number([...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1].toFixed(2));
async function device(id) {
  const journal = new EncryptedJournal(join(directory, `${id}.sqlite`), randomBytes(32), id);
  journals.push(journal);
  const result = await ProtocolDevice.open(journal, id, id, pins);
  pins.set(id, result.publicIdentity());
  return result;
}
try {
  const started = performance.now();
  const alice = await device('alice'), bob = await device('bob'), admin = await device('audit');
  await alice.create('benchmark');
  const invitation = await alice.changeMembers('benchmark', 'join', {
    add: [await bob.publishKeyPackage(), await admin.publishKeyPackage()],
  });
  await bob.join('benchmark', 'alice', invitation.welcome);
  await admin.join('benchmark', 'alice', invitation.welcome);
  results.setupThreeDevicesMs = Number((performance.now() - started).toFixed(2));
  const send = [], receive = [], audit = [];
  for (let i = 0; i < 110; i++) {
    const start = performance.now();
    const packet = await alice.send('benchmark', `message-${i}`, { text: 'x'.repeat(1024) });
    const sent = performance.now();
    await bob.receive(packet);
    const received = performance.now();
    await admin.receive(packet);
    const done = performance.now();
    if (i >= 10) {
      send.push(sent - start); receive.push(received - sent); audit.push(done - received);
    }
  }
  for (const [name, samples] of Object.entries({ sendWithPersistence: send, receiveWithPersistence: receive, adminReceiveWithPersistence: audit })) {
    results[name] = { samples: samples.length, medianMs: percentile(samples, .5), p95Ms: percentile(samples, .95) };
  }
  const start = performance.now();
  const removal = await alice.changeMembers('benchmark', 'revoke-bob', { remove: ['bob'] });
  await admin.receiveCommit('benchmark', removal.commit);
  results.revokeAndRekeyMs = Number((performance.now() - start).toFixed(2));
  console.log(JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch, cryptoSubtle: !!globalThis.crypto?.subtle, payloadBytes: 1024, deviceCount: 3, scope: 'desktop synthetic; encrypted SQLite FULL durability; no network or UI; no mobile claims', results }, null, 2));
} finally {
  for (const journal of journals) journal.close();
  rmSync(directory, { recursive: true, force: true });
}
