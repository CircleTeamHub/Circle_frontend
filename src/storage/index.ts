import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';
import {
  getEncryptedInstance,
  initEncryptedStorage,
} from './encrypted-init';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

function warnNotReady(op: string, key?: string): void {
  if (isDev) {
    console.warn(
      `[storage] ${op}(${key ?? ''}) before initEncryptedStorage() resolved — ` +
        'returning fallback. Startup-path readers must tolerate this and ' +
        're-apply after the app gate (see i18n rehydrateLanguageFromStorage).',
    );
  }
}

/**
 * Singleton MMKV handle（FE#87 起为加密实例的同步壳）。
 *
 * 真实实例由 initEncryptedStorage() 在启动门内异步建好（密钥在
 * SecureStore）。壳保持旧的同步 API 形状 —— 初始化完成后所有调用零开销
 * 直达；初始化前的读返回 undefined/false、写与删丢弃并 dev 告警。
 * 启动期唯一的两个前置读者（i18n 模块求值、主题首读）都有门后重应用补偿。
 */
export const storage = {
  getString(key: string): string | undefined {
    const mmkv = getEncryptedInstance();
    if (!mmkv) {
      warnNotReady('getString', key);
      return undefined;
    }
    return mmkv.getString(key);
  },
  getBoolean(key: string): boolean | undefined {
    const mmkv = getEncryptedInstance();
    if (!mmkv) {
      warnNotReady('getBoolean', key);
      return undefined;
    }
    return mmkv.getBoolean(key);
  },
  set(key: string, value: string | number | boolean): void {
    const mmkv = getEncryptedInstance();
    if (!mmkv) {
      warnNotReady('set', key);
      return;
    }
    mmkv.set(key, value);
  },
  remove(key: string): void {
    const mmkv = getEncryptedInstance();
    if (!mmkv) {
      warnNotReady('remove', key);
      return;
    }
    mmkv.remove(key);
  },
  contains(key: string): boolean {
    const mmkv = getEncryptedInstance();
    if (!mmkv) {
      warnNotReady('contains', key);
      return false;
    }
    return mmkv.contains(key);
  },
  clearAll(): void {
    const mmkv = getEncryptedInstance();
    if (!mmkv) {
      warnNotReady('clearAll');
      return;
    }
    mmkv.clearAll();
  },
} satisfies Partial<Record<keyof MMKV, unknown>> as unknown as Pick<
  MMKV,
  'getString' | 'getBoolean' | 'set' | 'remove' | 'contains' | 'clearAll'
>;

export { initEncryptedStorage };

/**
 * Zustand-compatible JSON storage adapter backed by MMKV.
 * All operations are synchronous; the Promise-returning shape exists only
 * to satisfy zustand's StateStorage type.
 */
export const mmkvJsonStorage: StateStorage = {
  // 初始化前返回 Promise（zustand persist 支持异步 storage，hydration 顺延
  // 到启动门内完成）；初始化后同步直达，保住 MMKV 的速度优势。
  getItem: (key) => {
    if (getEncryptedInstance()) return storage.getString(key) ?? null;
    return initEncryptedStorage().then(
      (mmkv) => mmkv.getString(key) ?? null,
    );
  },
  setItem: (key, value) => {
    if (getEncryptedInstance()) {
      storage.set(key, value);
      return;
    }
    return initEncryptedStorage().then((mmkv) => {
      mmkv.set(key, value);
    });
  },
  removeItem: (key) => {
    if (getEncryptedInstance()) {
      storage.remove(key);
      return;
    }
    return initEncryptedStorage().then((mmkv) => {
      mmkv.remove(key);
    });
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
