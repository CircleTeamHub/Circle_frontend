import { splitRecord } from './archive-store.mjs';
import { b64, unb64 } from './protocol.mjs';
import { openJournal, sealJournal } from './journal-codec.mjs';

const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Vault transaction aborted')); });

// IndexedDB contains ciphertext; the password and derived wrapping key are never persisted.
export async function openBrowserJournal(userId, password, databaseName = `circle-audit-v1-${userId}`) {
  if (password.length < 12) throw new Error('Use an unlock passphrase of at least 12 characters');
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) throw new Error('WebCrypto and IndexedDB are required');
  const opening = indexedDB.open(databaseName, 2);
  opening.onupgradeneeded = () => {
    if (!opening.result.objectStoreNames.contains('vault')) opening.result.createObjectStore('vault');
    if (!opening.result.objectStoreNames.contains('archive')) opening.result.createObjectStore('archive');
  };
  const db = await request(opening);
  let key;
  try {
    let meta = await request(db.transaction('vault').objectStore('vault').get('metadata'));
    const fresh = !meta;
    meta ??= { userId, deviceId: crypto.randomUUID(), salt: b64(crypto.getRandomValues(new Uint8Array(32))), iterations: 600000 };
    if (meta.userId !== userId || meta.iterations !== 600000 || unb64(meta.salt).length !== 32) throw new Error('Invalid vault metadata');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    key = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(meta.salt), iterations: meta.iterations }, material, 256));
    const scope = `circle-audit-v1:${userId}:${meta.deviceId}`;
    if (fresh) {
      meta.probe = b64(sealJournal(key, `${scope}:probe`, 1, { userId, deviceId: meta.deviceId }));
      const tx = db.transaction('vault', 'readwrite');
      const done = completed(tx);
      tx.objectStore('vault').add(meta, 'metadata');
      await done;
    } else {
      const probe = openJournal(key, `${scope}:probe`, 1, unb64(meta.probe));
      if (probe.userId !== userId || probe.deviceId !== meta.deviceId) throw new Error('Wrong vault');
    }
    let closed = false;
    const assertOpen = () => { if (closed) throw new Error('Administrator vault is locked'); };
    return {
      deviceId: meta.deviceId,
      async load() {
        assertOpen();
        const row = await request(db.transaction('vault').objectStore('vault').get('journal'));
        assertOpen();
        return row ? { revision: row.revision, record: openJournal(key, scope, row.revision, unb64(row.sealed)) } : { revision: 0, record: null };
      },
      async getItem(bucket, id) {
        assertOpen();
        const sealed = await request(db.transaction('archive').objectStore('archive').get([bucket, id]));
        assertOpen();
        return sealed ? openJournal(key, `${scope}:${bucket}:${id}`, 1, unb64(sealed)) : undefined;
      },
      async pageItems(bucket, after, limit) {
        assertOpen();
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid archive page size');
        const store = db.transaction('archive').objectStore('archive');
        const range = IDBKeyRange.bound([bucket, after], [bucket, '\uffff'], true, false);
        const [ids, rows] = await Promise.all([request(store.getAllKeys(range, limit)), request(store.getAll(range, limit))]);
        assertOpen();
        return ids.map((id, i) => ({ id: id[1], value: openJournal(key, `${scope}:${bucket}:${id[1]}`, 1, unb64(rows[i])) }));
      },
      async save(expectedRevision, record, beforeCommit) {
        assertOpen();
        const revision = expectedRevision + 1;
        const { hot, items } = splitRecord(record);
        const sealed = b64(sealJournal(key, scope, revision, hot));
        const tx = db.transaction(['vault', 'archive'], 'readwrite');
        const done = completed(tx);
        const store = tx.objectStore('vault');
        const read = store.get('journal');
        read.onsuccess = () => {
          try {
            assertOpen();
            if ((read.result?.revision ?? 0) !== expectedRevision) throw new Error('Concurrent vault update');
            store.put({ revision, sealed }, 'journal');
            const archive = tx.objectStore('archive');
            for (const item of items) {
              const itemScope = `${scope}:${item.bucket}:${item.id}`;
              const existing = archive.get([item.bucket, item.id]);
              existing.onsuccess = () => {
                try {
                  assertOpen();
                  if (existing.result && JSON.stringify(openJournal(key, itemScope, 1, unb64(existing.result))) !== JSON.stringify(item.value)) throw new Error('Conflicting archive record');
                  if (!existing.result) archive.add(b64(sealJournal(key, itemScope, 1, item.value)), [item.bucket, item.id]);
                } catch { tx.abort(); }
              };
            }
            beforeCommit?.();
          } catch { tx.abort(); }
        };
        await done;
      },
      async close() { if (closed) return; closed = true; key.fill(0); db.close(); },
    };
  } catch (error) { key?.fill(0); db.close(); throw error; }
}
