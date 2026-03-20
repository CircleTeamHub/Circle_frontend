import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export function useAuth() {
  const router = useRouter();
  const { setAuth, logout: storeLogout, isAuthenticated, isLoading } = useAuthStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (phone: string, password: string) => {
      setError(null);
      if (!phone.trim()) {
        setError('请输入手机号');
        return;
      }
      if (!password.trim()) {
        setError('请输入密码');
        return;
      }
      setSubmitting(true);
      try {
        // Mock login — replace with real API call
        await new Promise((resolve) => setTimeout(resolve, 800));
        setAuth('mock-token-' + Date.now(), {
          id: '1',
          uid: phone,
          nickname: '用户' + phone.slice(-4),
          avatarUrl: null,
          city: null,
        });
        router.replace('/(tabs)/messages');
      } catch {
        setError('登录失败，请重试');
      } finally {
        setSubmitting(false);
      }
    },
    [setAuth, router],
  );

  const register = useCallback(
    async (phone: string, code: string, password: string, nickname: string) => {
      setError(null);
      if (!phone.trim()) { setError('请输入手机号'); return; }
      if (!code.trim()) { setError('请输入验证码'); return; }
      if (password.length < 6) { setError('密码至少6位'); return; }
      if (!nickname.trim()) { setError('请输入昵称'); return; }

      setSubmitting(true);
      try {
        // Mock register — replace with real API call
        await new Promise((resolve) => setTimeout(resolve, 800));
        setAuth('mock-token-' + Date.now(), {
          id: '1',
          uid: phone,
          nickname,
          avatarUrl: null,
          city: null,
        });
        router.replace('/(tabs)/messages');
      } catch {
        setError('注册失败，请重试');
      } finally {
        setSubmitting(false);
      }
    },
    [setAuth, router],
  );

  const logout = useCallback(() => {
    storeLogout();
    router.replace('/(auth)/login');
  }, [storeLogout, router]);

  const sendCode = useCallback(async (phone: string) => {
    if (!phone.trim()) { setError('请先输入手机号'); return false; }
    // Mock send code
    await new Promise((resolve) => setTimeout(resolve, 500));
    return true;
  }, []);

  return { login, register, logout, sendCode, submitting, error, isAuthenticated, isLoading };
}
