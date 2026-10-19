import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { b64, unb64, type Journal, type JournalRecord } from '@circle/e2ee';
import { splitRecord } from '@circle/e2ee/archive-store.mjs';
import { openJournal, sealJournal } from '@circle/e2ee/journal-codec.mjs';

// The protocol requires an OS CSPRNG. Never replace this with Math.random.
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  const crypto = globalThis.crypto ?? {};
  Object.defineProperty(crypto, 'getRandomValues', { value: Crypto.getRandomValues });
  Object.defineProperty(globalThis, 'crypto', { value: crypto, configurable: true });
}

interface StoredRow { revision: number; sealed: Uint8Array }
export interface DeviceJournal extends Journal {
  deviceId: string;
  close(): Promise<void>;
}

const opening = new Map<string, Promise<DeviceJournal>>();

export function openDeviceJournal(userId: string): Promise<DeviceJournal> {
  let pending = opening.get(userId);
  if (!pending) {
    pending = createDeviceJournal(userId).catch((error: unknown) => {
      opening.delete(userId);
      throw error;
    });
    opening.set(userId, pending);
  }
  return pending;
}

// Unlike the legacy chat cache, this is authoritative key state: any storage
// failure aborts the operation. It must never fall back to plaintext or memory.
async function createDeviceJournal(userId: string): Promise<DeviceJournal> {
  if (!/^[A-Za-z0-9-]{1,120}$/.test(userId)) throw new Error('Invalid account');
  const scope = `circle.e2ee.${userId}`;
  let saved = await SecureStore.getItemAsync(scope);
  const storedName: unknown = saved ? JSON.parse(saved).databaseName : undefined;
  const defaultName = `e2ee-v1-${userId}.sqlite`;
  if (storedName !== undefined && (typeof storedName !== 'string' || !new RegExp(`^e2ee-v2-${userId}-[a-f0-9-]{36}\\.sqlite$`).test(storedName))) throw new Error('Invalid encrypted database name');
  const db = await SQLite.openDatabaseAsync(typeof storedName === 'string' ? storedName : defaultName);
  let key: Uint8Array | undefined;
  try {
    await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, sealed BLOB NOT NULL); CREATE TABLE IF NOT EXISTS archive (bucket TEXT NOT NULL, id TEXT NOT NULL, sealed BLOB NOT NULL, PRIMARY KEY(bucket, id))');
    if (!saved) {
      const row = await db.getFirstAsync<StoredRow>('SELECT revision FROM journal WHERE id=1');
      if (row) throw Object.assign(new Error('Encryption key unavailable; approve a new device to recover access'), { code: 'E2EE_LOCAL_KEY_MISSING' });
      const created = Crypto.getRandomBytes(32);
      try {
        saved = JSON.stringify({ deviceId: Crypto.randomUUID(), key: b64(created) });
        await SecureStore.setItemAsync(scope, saved, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      } finally { created.fill(0); }
    }
    const identity: { deviceId: string; key: string } = JSON.parse(saved);
    key = unb64(identity.key);
    if (key.length !== 32 || !/^[A-Za-z0-9-]{1,120}$/.test(identity.deviceId)) throw new Error('Invalid device key state');
    const storageKey = key;
    const aadScope = `${scope}:${identity.deviceId}`;
    let closed = false;
    const assertOpen = () => { if (closed) throw new Error('Encrypted storage locked'); };
    return {
      deviceId: identity.deviceId,
      async load() {
        assertOpen();
        const row = await db.getFirstAsync<StoredRow>('SELECT revision, sealed FROM journal WHERE id=1');
        assertOpen();
        return row ? { revision: row.revision, record: openJournal(storageKey, aadScope, row.revision, row.sealed) } : { revision: 0, record: null };
      },
      async getItem(bucket, id) {
        assertOpen();
        const row = await db.getFirstAsync<{ sealed: Uint8Array }>('SELECT sealed FROM archive WHERE bucket=? AND id=?', bucket, id);
        assertOpen();
        return row ? openJournal(storageKey, `${aadScope}:${bucket}:${id}`, 1, row.sealed) : undefined;
      },
      async pageItems(bucket, after, limit) {
        assertOpen();
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid archive page size');
        const rows = await db.getAllAsync<{ id: string; sealed: Uint8Array }>('SELECT id, sealed FROM archive WHERE bucket=? AND id>? ORDER BY id LIMIT ?', bucket, after, limit);
        assertOpen();
        return rows.map(row => ({ id: row.id, value: openJournal(storageKey, `${aadScope}:${bucket}:${row.id}`, 1, row.sealed) }));
      },
      async save(expectedRevision: number, record: JournalRecord, beforeCommit?: () => void) {
        assertOpen();
        const next = expectedRevision + 1;
        const { hot, items } = splitRecord(record);
        const sealed = sealJournal(storageKey, aadScope, next, hot);
        await db.withExclusiveTransactionAsync(async (tx) => {
          assertOpen();
          const result = expectedRevision === 0
            ? await tx.runAsync('INSERT OR IGNORE INTO journal (id, revision, sealed) VALUES(1, ?, ?)', next, sealed)
            : await tx.runAsync('UPDATE journal SET revision=?, sealed=? WHERE id=1 AND revision=?', next, sealed, expectedRevision);
          if (result.changes !== 1) throw new Error('Concurrent state change: reload before retry');
          for (const item of items) {
            const itemScope = `${aadScope}:${item.bucket}:${item.id}`;
            const existing = await tx.getFirstAsync<{ sealed: Uint8Array }>('SELECT sealed FROM archive WHERE bucket=? AND id=?', item.bucket, item.id);
            if (existing && JSON.stringify(openJournal(storageKey, itemScope, 1, existing.sealed)) !== JSON.stringify(item.value)) throw new Error('Conflicting archive record');
            if (!existing) await tx.runAsync('INSERT INTO archive(bucket, id, sealed) VALUES(?, ?, ?)', item.bucket, item.id, sealJournal(storageKey, itemScope, 1, item.value));
          }
          beforeCommit?.();
          assertOpen();
        });
      },
      async transformInbox(matches, transform, ids) {
        assertOpen();
        await db.withExclusiveTransactionAsync(async tx => {
          const rows = ids
            ? (await Promise.all(ids.map(id => tx.getFirstAsync<{id: string; sealed: Uint8Array}>("SELECT id, sealed FROM archive WHERE bucket='inbox' AND id=?", id)))).filter((row): row is {id: string; sealed: Uint8Array} => row !== null)
            : await tx.getAllAsync<{id: string; sealed: Uint8Array}>("SELECT id, sealed FROM archive WHERE bucket='inbox'");
          for (const row of rows) {
            assertOpen();
            const itemScope = `${aadScope}:inbox:${row.id}`;
            const value = openJournal(storageKey, itemScope, 1, row.sealed) as unknown as Record<string, unknown>;
            if (matches(value)) {
              await tx.runAsync("UPDATE archive SET sealed=? WHERE bucket='inbox' AND id=?", sealJournal(storageKey, itemScope, 1, transform(value)), row.id);
            }
          }
        });
      },
      async close() {
        if (closed) return;
        closed = true;
        opening.delete(userId);
        storageKey.fill(0);
        await db.closeAsync();
      },
    };
  } catch (error) {
    key?.fill(0);
    await db.closeAsync();
    throw error;
  }
}

// Explicit lost-Keychain recovery. The old sealed database is retained; an
// existing private key is never replaced by this operation.
export async function prepareReplacementJournal(userId: string): Promise<void> {
  if (!/^[A-Za-z0-9-]{1,120}$/.test(userId)) throw new Error('Invalid account');
  if (opening.has(userId)) throw new Error('Close the current encrypted vault first');
  const scope = `circle.e2ee.${userId}`;
  if (await SecureStore.getItemAsync(scope)) throw new Error('An encryption key already exists');
  const deviceId = Crypto.randomUUID();
  const key = Crypto.getRandomBytes(32);
  try {
    await SecureStore.setItemAsync(scope, JSON.stringify({ deviceId, key: b64(key), databaseName: `e2ee-v2-${userId}-${deviceId}.sqlite` }), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  } finally { key.fill(0); }
}
