import { Platform } from 'react-native';
import { storage } from '@/storage';
import { getEncryptedInstance } from './encrypted-init';
import { reportHandledFailure } from '@/observability/report-failure';

export type PageSnapshot<T> = { value: T; at: number };
type IndexEntry = { key: string; chars: number };
const PREFIX = 'circle-im-page-snapshot:v1:';
const INDEX_KEY = `${PREFIX}index`;
// Presentation only: bound synchronous JSON work and total retained storage.
const MAX_ENTRY_CHARS = 1_000_000;
const MAX_CACHE_CHARS = 4_000_000;
const MAX_ENTRIES = 160;
let revision = 0;

function ready() {
  // The browser adapter is plaintext; private page snapshots stay native-only.
  return Platform.OS !== 'web' && getEncryptedInstance() !== null;
}

function accountPrefix(userId: string) {
  return `${PREFIX}${encodeURIComponent(userId)}:`;
}

function snapshotKey(userId: string, key: string) {
  return `${accountPrefix(userId)}${encodeURIComponent(key)}`;
}

function readIndex(): IndexEntry[] {
  const raw = storage.getString(INDEX_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is IndexEntry =>
    typeof entry?.key === 'string' && entry.key.startsWith(PREFIX) &&
    typeof entry.chars === 'number' && Number.isFinite(entry.chars) && entry.chars >= 0,
  );
}

function reportCacheFailure(operation: string) {
  // JSON parse errors can quote cached content; never report the raw exception.
  reportHandledFailure('pageCache', operation, new Error('Page snapshot storage unavailable'));
}

export function getPageSnapshotRevision(): number {
  return revision;
}

export function getPageSnapshotStorageUsage(): { entries: number; bytes: number } {
  if (!ready()) return { entries: 0, bytes: 0 };
  try {
    const index = readIndex();
    // Logical UTF-16 size, consistent with the char-based storage budget.
    return { entries: index.length, bytes: index.reduce((sum, entry) => sum + entry.chars * 2, 0) };
  } catch {
    reportCacheFailure('size');
    return { entries: 0, bytes: 0 };
  }
}

export function readPageSnapshot<T>(userId: string | null | undefined, key: string): PageSnapshot<T> | null {
  if (!userId || !ready()) return null;
  try {
    const raw = storage.getString(snapshotKey(userId, key));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed) ||
      !('at' in parsed) || typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null;
    return parsed as PageSnapshot<T>;
  } catch {
    reportCacheFailure('read');
    return null;
  }
}

export function writePageSnapshot<T>(userId: string | null | undefined, key: string, value: T, at = Date.now()): void {
  if (!userId || !ready()) return;
  try {
    const target = snapshotKey(userId, key);
    const serialized = JSON.stringify({ value, at });
    const index = readIndex().filter((entry) => entry.key !== target);
    if (serialized.length > MAX_ENTRY_CHARS) {
      storage.remove(target);
      storage.set(INDEX_KEY, JSON.stringify(index));
      return;
    }
    index.push({ key: target, chars: serialized.length });
    let chars = index.reduce((sum, entry) => sum + entry.chars, 0);
    while (index.length > MAX_ENTRIES || chars > MAX_CACHE_CHARS) {
      const oldest = index.shift()!;
      storage.remove(oldest.key);
      chars -= oldest.chars;
    }
    // Index first: interrupted writes remain discoverable by logout/cache clear.
    storage.set(INDEX_KEY, JSON.stringify(index));
    storage.set(target, serialized);
  } catch {
    reportCacheFailure('write');
  }
}

export function removePageSnapshot(userId: string | null | undefined, key: string): void {
  if (!userId || !ready()) return;
  try {
    const target = snapshotKey(userId, key);
    storage.remove(target);
    storage.set(INDEX_KEY, JSON.stringify(readIndex().filter((entry) => entry.key !== target)));
  } catch {
    reportCacheFailure('remove');
  }
}

export function clearPageSnapshots(userId?: string, keyPrefix?: string): void {
  if (keyPrefix === undefined) revision += 1;
  if (!ready()) return;
  try {
    const prefix = userId ? `${accountPrefix(userId)}${encodeURIComponent(keyPrefix ?? '')}` : PREFIX;
    const remaining = readIndex().filter((entry) => {
      if (!entry.key.startsWith(prefix)) return true;
      storage.remove(entry.key);
      return false;
    });
    storage.set(INDEX_KEY, JSON.stringify(remaining));
  } catch {
    reportCacheFailure('clear');
  }
}
