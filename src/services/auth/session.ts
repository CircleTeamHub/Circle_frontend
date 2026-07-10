import { secureAuthStorage } from '@/storage/secure-auth-storage';
import {
  persistCurrentAuthState,
  useAuthStore,
} from '@/stores/authStore';
import { useFriendActivityUnreadStore } from '@/stores/friendActivityUnreadStore';
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';

type PersistCapableAuthStore = {
  persist?: {
    clearStorage?: () => Promise<void> | void;
  };
};

/**
 * 登出 teardown 钩子。session.ts 不再直接 import IM / 实时通道模块，避免
 * `services/api ↔ realtime ↔ services/api/* ↔ services/api/client` 与
 * `session ↔ im/client ↔ im/listeners ↔ session` 这两组模块循环。
 *
 * IM / 实时通道在自身模块加载时通过 registerLogoutHandler 注册 teardown，
 * 由 SessionBootstrap 在 app 启动时确保两个模块都被求值过。
 */
export interface LogoutContext {
  readonly sessionEpoch: number;
  isCurrent: () => boolean;
}

type LogoutHandler = (context: LogoutContext) => void | Promise<void>;
const logoutHandlers: LogoutHandler[] = [];
let activeClearPromise: Promise<void> | null = null;
let activeClearSessionEpoch: number | null = null;

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

async function loadMessageGroupsStore() {
  const { useMessageGroupsStore } = await import(
    '@/features/messages/store/use-message-groups-store'
  );
  return useMessageGroupsStore;
}

async function loadCirclesStore() {
  const { useCirclesStore } = await import(
    '@/features/discover/store/use-circles-store'
  );
  return useCirclesStore;
}

/**
 * 注册登出 teardown 钩子，返回反注册函数。HMR / 测试场景下可避免 handler 累积。
 * 同一个 handler 重复注册时只会保留一份。
 */
export function registerLogoutHandler(handler: LogoutHandler): () => void {
  if (!logoutHandlers.includes(handler)) {
    logoutHandlers.push(handler);
  }
  return () => {
    const idx = logoutHandlers.indexOf(handler);
    if (idx >= 0) logoutHandlers.splice(idx, 1);
  };
}

async function performClearLocalSession(sessionEpoch: number) {
  // teardown 失败不影响后续状态清理；失败汇总到末尾一次性 warn。
  const handlerFailures: unknown[] = [];
  const context: LogoutContext = {
    sessionEpoch,
    isCurrent: () => useAuthStore.getState().sessionEpoch === sessionEpoch,
  };
  const pendingHandlers: Promise<void>[] = [];

  for (const handler of logoutHandlers) {
    try {
      pendingHandlers.push(
        Promise.resolve(handler(context)).catch((err) => {
          handlerFailures.push(err);
        }),
      );
    } catch (err) {
      handlerFailures.push(err);
    }
  }
  await Promise.all(pendingHandlers);

  const useMessageGroupsStore = await loadMessageGroupsStore();
  const useCirclesStore = await loadCirclesStore();

  // 先清 auth，让订阅 useAuthStore 的组件立刻看到"未登录"，
  // 避免 dependent store 被清空后触发"重新拉取"再被丢弃的请求。
  if (!context.isCurrent()) {
    return;
  }

  useAuthStore.getState().clearSession();
  const clearedSessionEpoch = useAuthStore.getState().sessionEpoch;
  useMessageGroupsStore.getState().reset();
  useCirclesStore.getState().reset();
  useFriendActivityUnreadStore.getState().reset();
  useFriendRemarkStore.getState().reset();
  useTabBadgeStore.getState().reset();
  useWalletRealtimeStore.getState().reset();

  let persistCleared = false;
  try {
    const persistenceClear = (useAuthStore as PersistCapableAuthStore)
      .persist?.clearStorage?.();
    if (persistenceClear && typeof persistenceClear.then === 'function') {
      await persistenceClear;
    } else {
      await secureAuthStorage.removeItem('circle-im-auth');
    }
    persistCleared = true;
  } catch (err) {
    if (isDev) console.warn('[session] persist.clearStorage failed', err);
  }
  // 兜底：persist 未挂或 clearStorage 抛错时，直接对 SecureStore + legacy MMKV key 显式清理。
  // tokens 留在磁盘比"登出失败"提示风险更高 —— 下次启动会自动重新认证回这个用户。
  if (!persistCleared) {
    try {
      await secureAuthStorage.removeItem('circle-im-auth');
    } catch (err) {
      if (isDev) console.warn('[session] secure auth removeItem fallback failed', err);
    }
  }

  if (useAuthStore.getState().sessionEpoch !== clearedSessionEpoch) {
    try {
      await persistCurrentAuthState();
    } catch (err) {
      if (isDev) console.warn('[session] persist newer auth session failed', err);
    }
  }

  if (isDev && handlerFailures.length > 0) {
    console.warn('[session] logout handlers failed', handlerFailures);
  }
}

export function clearLocalSession(expectedSessionEpoch?: number): Promise<void> {
  const sessionEpoch =
    expectedSessionEpoch ?? useAuthStore.getState().sessionEpoch;

  if (useAuthStore.getState().sessionEpoch !== sessionEpoch) {
    return Promise.resolve();
  }

  if (activeClearPromise) {
    if (activeClearSessionEpoch === sessionEpoch) {
      return activeClearPromise;
    }
    return activeClearPromise
      .catch(() => undefined)
      .then(() => clearLocalSession(sessionEpoch));
  }

  const operation = performClearLocalSession(sessionEpoch);
  let trackedOperation: Promise<void>;
  trackedOperation = operation.finally(() => {
    if (activeClearPromise === trackedOperation) {
      activeClearPromise = null;
      activeClearSessionEpoch = null;
    }
  });
  activeClearSessionEpoch = sessionEpoch;
  activeClearPromise = trackedOperation;
  return trackedOperation;
}
