import { logoutFromOpenIM } from '@/im/client';
import { disconnectRealtime } from '@/realtime/client';
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

export async function clearLocalSession() {
  disconnectRealtime();

  try {
    await logoutFromOpenIM();
  } catch {
    // IM 退出失败不影响本地鉴权状态清理
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
