import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

/**
 * Singleton MMKV instance for the entire app.
 * Synchronous, ~30x faster than AsyncStorage. Used as the persistence
 * layer for all zustand stores and ad-hoc preference reads/writes.
 */
export const storage = createMMKV({ id: 'circle-im' });

/**
 * Zustand-compatible JSON storage adapter backed by MMKV.
 * All operations are synchronous; the Promise-returning shape exists only
 * to satisfy zustand's StateStorage type.
 */
export const mmkvJsonStorage: StateStorage = {
  getItem: (key) => storage.getString(key) ?? null,
  setItem: (key, value) => {
    storage.set(key, value);
  },
  removeItem: (key) => {
    storage.remove(key);
  },
};

/**
 * Keys that previously lived in AsyncStorage. Migration copies their values
 * into MMKV on first launch after upgrading, then removes them from
 * AsyncStorage so the legacy store can be garbage-collected.
 */
const LEGACY_KEYS = [
  'circle-im-auth',
  'circle-im-chat-preferences',
  'circle-im-discover-filter',
  'circle-im-circle-notification',
  'circle-im-theme-mode',
  '@circle_im_language',
] as const;

const MIGRATION_FLAG = '__migrated_from_async_storage_v1';

let migrationPromise: Promise<void> | null = null;

/**
 * Idempotent one-shot migration from AsyncStorage to MMKV.
 * Safe to call multiple times — only the first invocation does work.
 * Resolves once existing data is mirrored into MMKV. Failures fall back
 * to defaults (the app keeps working, just without the legacy values).
 */
export function migrateFromAsyncStorage(): Promise<void> {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    if (storage.getBoolean(MIGRATION_FLAG)) return;

    try {
      const entries = await AsyncStorage.multiGet([...LEGACY_KEYS]);
      for (const [key, value] of entries) {
        if (value !== null && !storage.contains(key)) {
          storage.set(key, value);
        }
      }
      await AsyncStorage.multiRemove([...LEGACY_KEYS]);
      // 仅在拷贝 + 清理全部成功后才记完成标记。失败不设置 flag —— 让下次启动重试，
      // 避免半迁移状态被 "已完成" 标记永久封死。
      storage.set(MIGRATION_FLAG, true);
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(
          '[storage] AsyncStorage → MMKV migration failed; will retry next launch',
          err,
        );
      }
      // 故意不 rethrow：调用方（app/_layout.tsx）必须始终前进，
      // 否则启动屏会无限挂住。
    }
  })();

  return migrationPromise;
}
