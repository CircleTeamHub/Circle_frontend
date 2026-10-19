import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openBrowserJournal } from '../../packages/e2ee/browser-journal.mjs';
import { ProtocolDevice } from '../../packages/e2ee/protocol.mjs';
const password = 'local-testing-passphrase-only';

test('browser vault survives restart, rejects wrong password and has no plaintext at rest', async () => {
  const name = `vault-${crypto.randomUUID()}`;
  const vault = await openBrowserJournal('admin', password, name);
  const device = await ProtocolDevice.open(vault, 'admin', vault.deviceId, new Map());
  const publicKey = device.publicIdentity().publicKey;
  const { record, revision } = await vault.load();
  record.inbox.sample = { body: { text: 'plaintext-never-on-disk' } };
  await vault.save(revision, record);
  const open = indexedDB.open(name);
  const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = reject; });
  const request = db.transaction('vault').objectStore('vault').getAll();
  const rows = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
  assert.equal(JSON.stringify(rows).includes('plaintext-never-on-disk'), false);
  assert.equal(JSON.stringify(rows).includes(record.signing.signKey), false);
  db.close();
  await vault.close();
  await assert.rejects(vault.load(), /locked/);
  await assert.rejects(openBrowserJournal('admin', 'incorrect-password-here', name));
  await assert.rejects(openBrowserJournal('other-admin', password, name));
  const restored = await openBrowserJournal('admin', password, name);
  const reopened = await ProtocolDevice.open(restored, 'admin', restored.deviceId, new Map());
  assert.equal(reopened.publicIdentity().publicKey, publicKey);
  assert.equal((await restored.getItem('inbox', 'sample')).body.text, 'plaintext-never-on-disk');
  await restored.close();
});

test('browser vault refuses stale writers and rolls back an interrupted transaction', async () => {
  const name = `vault-${crypto.randomUUID()}`;
  const one = await openBrowserJournal('admin', password, name);
  const two = await openBrowserJournal('admin', password, name);
  await one.save(0, { value: 'first' });
  await assert.rejects(two.save(0, { value: 'stale' }));
  await assert.rejects(one.save(1, { value: 'interrupted' }, () => { throw new Error('power loss'); }));
  assert.deepEqual(await two.load(), { revision: 1, record: { value: 'first' } });
  await Promise.all([one.close(), two.close()]);
});

test('browser archive is paginated, encrypted and transactionally isolated from hot state', async () => {
  const name = `vault-${crypto.randomUUID()}`;
  const vault = await openBrowserJournal('admin', password, name);
  const inbox = Object.fromEntries(Array.from({ length: 1100 }, (_, i) => [String(i).padStart(5, '0'), { body: { text: 'private-archive-' + i } }]));
  await vault.save(0, { inbox, outbox: {}, marker: 'ratchet' });
  assert.deepEqual((await vault.load()).record.inbox, {});
  const page = await vault.pageItems('inbox', '00099', 100);
  assert.equal(page.length, 100);
  assert.equal(page[0].id, '00100');
  await assert.rejects(vault.save(1, { inbox: { '00000': { body: { text: 'changed' } } }, outbox: {}, marker: 'wrong ratchet' }));
  assert.equal((await vault.load()).record.marker, 'ratchet');
  assert.equal((await vault.getItem('inbox', '00000')).body.text, 'private-archive-0');
  const opening = indexedDB.open(name);
  const db = await new Promise(resolve => { opening.onsuccess = () => resolve(opening.result); });
  const request = db.transaction('archive').objectStore('archive').getAll();
  const rows = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
  assert.equal(JSON.stringify(rows).includes('private-archive-'), false);
  db.close(); await vault.close();
});
