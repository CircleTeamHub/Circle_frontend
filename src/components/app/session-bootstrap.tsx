import { useEffect } from 'react';
import { AppState } from 'react-native';
import { fetchCurrentUser } from '@/services/api/auth';
import { loginToOpenIM, logoutFromOpenIM } from '@/im/client';
import {
  connectRealtime,
  disconnectRealtime,
  recoverTabBadgeSnapshot,
} from '@/realtime/client';
import { clearLocalSession } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';

/**
 * SessionBootstrap — 无 UI 的启动引导组件，挂载在 app 根节点。
 *
 * 职责：
 * 1. 注册 OpenIM SDK 全局事件监听器（连接状态、新消息等）
 * 2. 在 authStore 从 AsyncStorage 完成 hydration 后，自动恢复登录态：
 *    - 有 token → 请求 /auth/me 获取用户信息 → 用 imToken 登录 OpenIM
 *    - 无 token 或请求失败 → 清除 session，由 app/index.tsx 跳转登录页
 *
 * 该组件始终返回 null，不渲染任何 UI。
 */
export function SessionBootstrap() {
  const {
    accessToken,
    refreshToken,
    imToken,
    hasHydrated,
    isLoading,
    setUser,
    setLoading,
  } = useAuthStore();

  // OpenIM 全局事件由 ensureOpenIMInitialized() 在 initSDK 之前主动绑定，
  // 这里不再额外绑定 —— 否则 SessionBootstrap 卸载时会意外解绑全部 listener。

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!accessToken) {
      disconnectRealtime();
      return;
    }

    connectRealtime(accessToken);

    return () => {
      disconnectRealtime();
    };
  }, [accessToken, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }

      const nextAccessToken = useAuthStore.getState().accessToken;
      if (!nextAccessToken) {
        disconnectRealtime();
        return;
      }

      connectRealtime(nextAccessToken);
      void recoverTabBadgeSnapshot();
    });

    return () => {
      subscription.remove();
    };
  }, [hasHydrated]);

  // 在 store hydration 完成、且仍处于 loading 状态时执行一次会话恢复
  // isLoading 初始值为 true，bootstrap 完成后（无论成功/失败）通过 finally 置为 false
  useEffect(() => {
    if (!hasHydrated || !isLoading) {
      return;
    }

    // cancelled 标志用于防止组件卸载后继续写入 store
    let cancelled = false;

    const bootstrapSession = async () => {
      // 没有 token，直接退出 IM 并结束 loading
      if (!accessToken || !refreshToken) {
        await logoutFromOpenIM();
        if (!cancelled) {
          setLoading(false);
        }
        return;
      }

      try {
        // 用当前 accessToken 请求后端获取用户信息
        const user = await fetchCurrentUser();

        if (cancelled) {
          return;
        }

        setUser(user);

        if (imToken) {
          try {
            // 登录 OpenIM，失败时仅打印警告，不影响主 app 流程
            await loginToOpenIM(user.id, imToken);
          } catch (error) {
            console.warn(
              '[openim] bootstrap login failed',
              error instanceof Error ? error.message : error
            );
          }
        } else {
          // 没有 imToken，确保 IM 状态已清空
          await logoutFromOpenIM();
        }
      } catch {
        // /auth/me 请求失败（token 已过期/无效），清除 session 触发跳转登录页
        if (!cancelled) {
          await clearLocalSession();
        }
      } finally {
        // 无论成功还是失败，都要结束 loading 状态，防止 app 永久卡在加载中
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    bootstrapSession();

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    hasHydrated,
    imToken,
    isLoading,
    refreshToken,
    setLoading,
    setUser,
  ]);

  return null;
}
