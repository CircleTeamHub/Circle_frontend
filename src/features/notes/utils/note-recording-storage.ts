import { Platform } from 'react-native';

const DIRECTORY = 'note-recordings-v1';
const DATABASE = 'circle-im-note-recordings-v1';
const STORE = 'recordings';
const RECORDING_ID = /^recording-[a-z0-9-]{1,80}\.(m4a|webm)$/;
type NativeFS = typeof import('react-native-fs');
let nativeFSPromise: Promise<NativeFS> | undefined;
let databasePromise: Promise<IDBDatabase> | undefined;
const pendingCopies = new Map<string, Promise<StoredNoteRecording>>();

export type StoredNoteRecording = { localRecordingId: string; uri: string };

function accountKey(userId: string): string {
  // Account IDs are UUIDs. Bound every path component and reject separators,
  // including percent-encoded ones, rather than accepting a caller's path.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId)) throw new Error('Invalid recording account');
  return `account-${userId}`;
}

export function isNoteRecordingId(id: unknown): id is string {
  return typeof id === 'string' && RECORDING_ID.test(id);
}

function recordingId(): string {
  const random = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `recording-${random}.${Platform.OS === 'web' ? 'webm' : 'm4a'}`;
}

async function loadNativeFS(): Promise<NativeFS> {
  nativeFSPromise ??= import('react-native-fs').then((module) =>
    (module as NativeFS & { default?: NativeFS }).default ?? module);
  return nativeFSPromise;
}

function nativePath(fs: NativeFS, account: string, id: string): string {
  return `${fs.DocumentDirectoryPath.replace(/\/+$/, '')}/${DIRECTORY}/${account}/${id}`;
}

async function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Recording storage unavailable')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = request.onblocked = () => reject(new Error('Recording storage unavailable'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
  });
  try { return await databasePromise; }
  catch { databasePromise = undefined; throw new Error('Recording storage unavailable'); }
}

async function blobTransaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    const request = work(transaction.objectStore(STORE));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = transaction.onabort = () => reject(new Error('Recording storage failed'));
  });
}

/** Copy only our own recording; the cache/source file is never moved or deleted. */
export async function persistNoteRecording(userId: string, sourceUri: string): Promise<StoredNoteRecording> {
  const account = accountKey(userId);
  const key = `${account}:${sourceUri}`;
  const existing = pendingCopies.get(key);
  if (existing) return existing;
  const work = (async () => {
    const id = recordingId();
    if (!isNoteRecordingId(id)) throw new Error('Invalid recording ID');
    if (Platform.OS === 'web') {
      if (!sourceUri.startsWith('blob:')) throw new Error('Invalid recording source');
      const response = await fetch(sourceUri);
      if (!response.ok) throw new Error('Recording unavailable');
      const blob = await response.blob();
      if (!blob.size) throw new Error('Recording unavailable');
      await blobTransaction('readwrite', (store) => store.put(blob, `${account}:${id}`));
      return { localRecordingId: id, uri: sourceUri };
    }
    const fs = await loadNativeFS();
    const source = sourceUri.startsWith('file://') ? decodeURIComponent(sourceUri.slice(7)) : sourceUri;
    if (!source.startsWith('/')) throw new Error('Invalid recording source');
    const destination = nativePath(fs, account, id);
    try {
      await fs.mkdir(`${fs.DocumentDirectoryPath}/${DIRECTORY}`, { NSURLIsExcludedFromBackupKey: true });
      await fs.mkdir(`${fs.DocumentDirectoryPath}/${DIRECTORY}/${account}`, { NSURLIsExcludedFromBackupKey: true });
      await fs.copyFile(source, destination);
      return { localRecordingId: id, uri: `file://${destination}` };
    } catch {
      // copyFile may leave an incomplete destination. Never unlink its source.
      if (await fs.exists(destination).catch(() => false)) await fs.unlink(destination).catch(() => undefined);
      throw new Error('Recording storage failed');
    }
  })();
  pendingCopies.set(key, work);
  try { return await work; }
  catch { throw new Error('Recording storage failed'); }
  finally { pendingCopies.delete(key); }
}

/** Resolve the current container path, or create a new object URL after reload. */
export async function restoreNoteRecording(userId: string, id: string): Promise<string | undefined> {
  const account = accountKey(userId);
  if (!isNoteRecordingId(id)) return undefined;
  if (Platform.OS === 'web') {
    const blob = await blobTransaction<Blob | undefined>('readonly', (store) => store.get(`${account}:${id}`));
    return blob?.size ? URL.createObjectURL(blob) : undefined;
  }
  const fs = await loadNativeFS();
  const path = nativePath(fs, account, id);
  return await fs.exists(path) ? `file://${path}` : undefined;
}

/** Only validated IDs within the captured account's directory/store can be removed. */
export async function removeNoteRecording(userId: string, id: string): Promise<void> {
  const account = accountKey(userId);
  if (!isNoteRecordingId(id)) return;
  if (Platform.OS === 'web') {
    await blobTransaction('readwrite', (store) => store.delete(`${account}:${id}`));
    return;
  }
  const fs = await loadNativeFS();
  const path = nativePath(fs, account, id);
  if (await fs.exists(path)) await fs.unlink(path);
}
