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
import { loginToOpenIM, logoutFromOpenIM } from '@/im/client';
import { ApiError } from '@/services/api/client';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function useAuth() {
  const router = useRouter();
  const {
    setSession,
    clearSession,
    isAuthenticated,
    isLoading,
  } = useAuthStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (account: string, password: string) => {
      setError(null);
      const username = account.trim();

      if (!username) {
        setError("请输入账号");
        return;
      }
      if (!password.trim()) {
        setError("请输入密码");
        return;
      }
      setSubmitting(true);
      try {
        const tokens = await loginRequest({
          username,
          password,
        });
        const user = await fetchCurrentUserWithToken(tokens.accessToken);

        setSession(tokens, user);

        if (tokens.imToken) {
          try {
            await loginToOpenIM(user.accountId, tokens.imToken);
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
        router.replace('/(tabs)/messages');
      } catch (requestError) {
        await logoutFromOpenIM();
        clearSession();
        setError(getErrorMessage(requestError, '登录失败，请重试'));
      } finally {
        setSubmitting(false);
      }
    },
    [clearSession, router, setSession],
  );

  const register = useCallback(
    async (
      account: string,
      password: string,
      nickname: string,
      confirmPassword: string,
    ) => {
      setError(null);
      if (!account.trim()) {
        setError("请输入账号");
        return;
      }
      if (password.length < 6) {
        setError("密码至少6位");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次密码不一致");
        return;
      }
      if (!nickname.trim()) {
        setError("请输入昵称");
        return;
      }

      setSubmitting(true);
      try {
        await registerRequest({
          username: account.trim(),
          password,
          nickname: nickname.trim(),
        });
        router.replace('/(auth)/login');
      } catch (requestError) {
        setError(getErrorMessage(requestError, '注册失败，请重试'));
      } finally {
        setSubmitting(false);
      }
    },
    [router],
  );

  const logout = useCallback(async () => {
    const { refreshToken } = useAuthStore.getState();

    try {
      if (refreshToken) {
        await logoutRequest(refreshToken);
      }
    } catch {
      // Ignore logout API failures and always clear the local session.
    } finally {
      await logoutFromOpenIM();
      clearSession();
      router.replace('/(auth)/login');
    }
  }, [clearSession, router]);

  return {
    login,
    register,
    logout,
    submitting,
    error,
    isAuthenticated,
    isLoading,
  };
}
