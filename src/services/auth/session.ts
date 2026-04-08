import { logoutFromOpenIM } from '@/im/client';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { useAuthStore } from '@/stores/authStore';

type PersistCapableAuthStore = typeof useAuthStore & {
  persist?: {
    clearStorage?: () => Promise<void> | void;
  };
};

export async function clearLocalSession() {
  try {
    await logoutFromOpenIM();
  } catch {
    // IM 退出失败不影响本地鉴权状态清理
  }

  useMessageGroupsStore.getState().reset();
  useAuthStore.getState().clearSession();

  try {
    await (useAuthStore as PersistCapableAuthStore).persist?.clearStorage?.();
  } catch {
    // 持久化层清理失败时，内存态也已清空，不阻断登出流程
  }
}
