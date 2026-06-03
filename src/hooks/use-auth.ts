/**
 * use-auth.ts — 认证业务 Hook
 *
 * 封装 login / register / logout 三个操作，每个操作会：
 * 1. 调用后端 API
 * 2. 同步更新 authStore（token + user）
 * 3. 登录/登出 OpenIM
 * 4. 成功后通过 expo-router 跳转目标页面
 *
 * 对外暴露 submitting（loading 状态）和 error（错误文本）供 UI 展示。
 */
import { useAuthStore } from '@/stores/authStore';
import {
  fetchCurrentUserWithToken,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from '@/services/api/auth';
import { clearLocalSession } from '@/services/auth/session';
import { loginToOpenIM, logoutFromOpenIM } from '@/im/client';
import { getApiErrorMessage } from '@/services/api/errors';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { retry } from '@/utils/retry';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export function useAuth() {
  const router = useRouter();
  // selector 化：避免订阅整个 authStore —— token 后台刷新或别处更新 user
  // 不会重渲染挂载了这个 hook 的所有屏幕。
  const setSession = useAuthStore((state) => state.setSession);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 在 await 长链路中守护 setState：用户在登录/登出中途离开屏幕时
  // 不再触发 "setState on unmounted component" 警告。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const safeSetError = useCallback((value: string | null) => {
    if (mountedRef.current) setError(value);
  }, []);
  const safeSetSubmitting = useCallback((value: boolean) => {
    if (mountedRef.current) setSubmitting(value);
  }, []);

  // Pattern D / 双重防抖：disabled={submitting} 在 fast double-tap 下可能晚一帧
  // 才生效；用 ref 在 hook 入口处再判断一次，确保同一时刻只有一次登录/注册/登出。
  const inFlightRef = useRef(false);

  const login = useCallback(
    async (account: string, password: string) => {
      if (inFlightRef.current) return;
      safeSetError(null);
      const username = account.trim();

      if (!username) {
        safeSetError("请输入账号");
        return;
      }
      if (!password.trim()) {
        safeSetError("请输入密码");
        return;
      }
      inFlightRef.current = true;
      safeSetSubmitting(true);
      try {
        const tokens = await loginRequest({
          accountId: username,
          password,
        });
        // 拿到 token 后立刻拉 /auth/me；这是登录链路最容易被瞬时网络抖动击穿的一步。
        // retry 仅在网络 / 5xx 时重试；4xx（401/403）直接抛出走 clearLocalSession。
        const user = await retry(() =>
          fetchCurrentUserWithToken(tokens.accessToken),
        );

        setSession(tokens, user);

        if (tokens.imToken) {
          try {
            await loginToOpenIM(user.id, tokens.imToken);
          } catch (error) {
            // IM 登录失败不阻断主流程，仅打印警告；用户仍可正常使用 app
            console.warn(
              '[openim] login failed',
              error instanceof Error ? error.message : error
            );
          }
        } else {
          // 后端未返回 imToken，确保 IM 状态已清空
          await logoutFromOpenIM();
        }

        // 拉用户自定义会话分组（MessagesScreen 顶部 filter tab 需要）。
        // 失败不阻断登录跳转；store 内部已 dev-warn。
        void useMessageGroupsStore.getState().load();

        router.replace('/(tabs)/messages');
      } catch (requestError) {
        await clearLocalSession();
        safeSetError(getApiErrorMessage(requestError, '登录失败，请重试'));
      } finally {
        inFlightRef.current = false;
        safeSetSubmitting(false);
      }
    },
    [router, setSession, safeSetError, safeSetSubmitting],
  );

  const register = useCallback(
    async (
      account: string,
      password: string,
      nickname: string,
      confirmPassword: string,
    ) => {
      if (inFlightRef.current) return;
      safeSetError(null);
      if (!account.trim()) {
        safeSetError("请输入账号");
        return;
      }
      if (password.length < 6) {
        safeSetError("密码至少6位");
        return;
      }
      if (password !== confirmPassword) {
        safeSetError("两次密码不一致");
        return;
      }
      if (!nickname.trim()) {
        safeSetError("请输入昵称");
        return;
      }

      inFlightRef.current = true;
      safeSetSubmitting(true);
      try {
        await registerRequest({
          accountId: account.trim(),
          password,
          nickname: nickname.trim(),
        });
        router.replace('/(auth)/login');
      } catch (requestError) {
        safeSetError(getApiErrorMessage(requestError, '注册失败，请重试'));
      } finally {
        inFlightRef.current = false;
        safeSetSubmitting(false);
      }
    },
    [router, safeSetError, safeSetSubmitting],
  );

  const endSession = useCallback(async () => {
    if (inFlightRef.current) return;
    const { refreshToken } = useAuthStore.getState();

    safeSetError(null);
    inFlightRef.current = true;
    safeSetSubmitting(true);

    // 服务端登出与本地清理并行：网络慢时不让 UI 干等到 apiClient 15s 超时；
    // 失败也不阻塞本地登出 —— 但要在 dev 把错误打出来，避免长期静默回归。
    if (refreshToken) {
      void logoutRequest(refreshToken).catch((err) => {
        if (isDev) {
          console.warn('[auth] server logout failed (local session still cleared)', err);
        }
      });
    }

    try {
      await clearLocalSession();
    } finally {
      inFlightRef.current = false;
      safeSetSubmitting(false);
      router.replace('/(auth)/login');
    }
  }, [router, safeSetError, safeSetSubmitting]);

  const logout = useCallback(async () => {
    await endSession();
  }, [endSession]);

  const switchAccount = useCallback(async () => {
    await endSession();
  }, [endSession]);

  return {
    login,
    register,
    logout,
    switchAccount,
    submitting,
    error,
    isAuthenticated,
    isLoading,
  };
}
