import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
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

export function registerLogoutHandler(handler: LogoutHandler) {
  logoutHandlers.push(handler);
}

export async function clearLocalSession() {
  // teardown 失败不影响后续状态清理
  for (const handler of logoutHandlers) {
    try {
      await handler();
    } catch {
      // 单个 teardown 失败时继续跑剩下的
    }
  }

  useMessageGroupsStore.getState().reset();
  useFriendActivityUnreadStore.getState().reset();
  useTabBadgeStore.getState().reset();
  useWalletRealtimeStore.getState().reset();
  useAuthStore.getState().clearSession();

  try {
    await (useAuthStore as PersistCapableAuthStore).persist?.clearStorage?.();
  } catch {
    // 持久化层清理失败时，内存态也已清空，不阻断登出流程
  }
}
