import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { mmkvJsonStorage } from '@/storage';
import { useAuthStore } from '@/stores/authStore';
import { useFriendActivityUnreadStore } from '@/stores/friendActivityUnreadStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';

type PersistCapableAuthStore = typeof useAuthStore & {
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
type LogoutHandler = () => void | Promise<void>;
const logoutHandlers: LogoutHandler[] = [];

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

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

export async function clearLocalSession() {
  // teardown 失败不影响后续状态清理；失败汇总到末尾一次性 warn。
  const handlerFailures: unknown[] = [];
  for (const handler of logoutHandlers) {
    try {
      await handler();
    } catch (err) {
      handlerFailures.push(err);
    }
  }

  // 先清 auth，让订阅 useAuthStore 的组件立刻看到"未登录"，
  // 避免 dependent store 被清空后触发"重新拉取"再被丢弃的请求。
  useAuthStore.getState().clearSession();
  useMessageGroupsStore.getState().reset();
  useFriendActivityUnreadStore.getState().reset();
  useTabBadgeStore.getState().reset();
  useWalletRealtimeStore.getState().reset();

  let persistCleared = false;
  try {
    await (useAuthStore as PersistCapableAuthStore).persist?.clearStorage?.();
    persistCleared = true;
  } catch (err) {
    if (isDev) console.warn('[session] persist.clearStorage failed', err);
  }
  // 兜底：persist 未挂或 clearStorage 抛错时，直接对 MMKV key 显式清理。
  // tokens 留在磁盘比"登出失败"提示风险更高 —— 下次启动会自动重新认证回这个用户。
  if (!persistCleared) {
    try {
      await mmkvJsonStorage.removeItem('circle-im-auth');
    } catch (err) {
      if (isDev) console.warn('[session] mmkv removeItem fallback failed', err);
    }
  }

  if (isDev && handlerFailures.length > 0) {
    console.warn('[session] logout handlers failed', handlerFailures);
  }
}
