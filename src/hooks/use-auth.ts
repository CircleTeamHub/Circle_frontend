/**
 * use-auth.ts — 认证业务 Hook
 *
 * 封装 login / register / logout 三个操作，每个操作会：
 * 1. 调用后端 API
 * 2. 同步更新 authStore（token + user）
 * 3. 登录/登出 OpenIM
 * 4. 成功后由全局 AuthRouteGuard 根据 session 状态跳转目标页面
 *
 * 对外暴露 submitting（loading 状态）和 error（错误文本）供 UI 展示。
 */
import { useAuthStore } from '@/stores/authStore';
import {
  useKnownAccountsStore,
  type KnownAccount,
} from '@/stores/knownAccountsStore';
import { useAccountSwitcherStore } from '@/stores/accountSwitcherStore';
import {
  fetchCurrentUser,
  fetchCurrentUserWithToken,
  login as loginRequest,
  loginWithCode as loginWithCodeRequest,
  logout as logoutRequest,
  register as registerRequest,
  type AuthTokens,
} from '@/services/api/auth';
import { clearLocalSession } from '@/services/auth/session';
import { isDefinitiveAuthFailure } from '@/services/api/client';
import { loginToOpenIM, logoutFromOpenIM } from '@/im/client';
import { markIMLoginRetryPending } from '@/im/login-retry-pending';
import {
  recoverIMSession,
  getIMRecoveryGeneration,
} from '@/im/token-recovery';
import { isOpenIMTokenRejectedError } from '@/im/token-errors';
import { getApiErrorMessage } from '@/services/api/errors';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { retry } from '@/utils/retry';
import {
  validateLoginForm,
  validateLoginCodeForm,
  validateRegisterForm,
} from '@/features/auth/validation';
import i18n from '@/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

type AuthSuccessOptions = {
  onboardingRequired?: boolean;
  startAppServices?: boolean;
};

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

  // 密码登录与验证码登录的共同收尾：拉用户、落 session、记账号、登 IM、跳转。
  const onAuthSuccess = useCallback(
    async (tokens: AuthTokens, options: AuthSuccessOptions = {}) => {
      // 拿到 token 后立刻拉 /auth/me；这是登录链路最容易被瞬时网络抖动击穿的一步。
      // retry 仅在网络 / 5xx 时重试；4xx（401/403）直接抛出走 clearLocalSession。
      const user = await retry(() =>
        fetchCurrentUserWithToken(tokens.accessToken),
      );

      setSession(tokens, user, {
        onboardingRequired: options.onboardingRequired ?? false,
      });

      // 记入「本设备登录过的账号」，供切换账号免密快速进入。
      useKnownAccountsStore.getState().upsertAccount({
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        imToken: tokens.imToken,
        updatedAt: Date.now(),
      });

      if (options.startAppServices !== false) {
        if (tokens.imToken) {
          const recoveryGenerationBefore = getIMRecoveryGeneration();
          try {
            await loginToOpenIM(user.id, tokens.imToken);
          } catch (imError) {
            // IM 登录失败不阻断主流程，仅打印警告；用户仍可正常使用 app
            console.warn(
              '[openim] login failed',
              imError instanceof Error ? imError.message : imError,
            );
            if (isOpenIMTokenRejectedError(imError)) {
              // token 被服务端明确拒绝：换新 IM token 原地恢复。
              void recoverIMSession();
            } else if (getIMRecoveryGeneration() === recoveryGenerationBefore) {
              // 含连接就绪超时(CONNECTION_NOT_READY)在内的其它失败：token 仍有效，
              // 换 token 反而会强制登出还在连接中的会话、弱网下空转成环。热登录已把
              // auth loading 置 false、bootstrap 不会再补登，故挂共享欠账，回前台用
              // 同一枚 token 重试。
              // 但若登录期间被踢下线(多端顶替,代次已变),handleKickedOffline 已清欠账+
              // 取消恢复,这里绝不能再挂——否则回前台又重登、把顶替本端的新设备再踢下线。
              markIMLoginRetryPending();
            }
            // 关键：不在此 return —— 否则会跳过下方 message groups 加载，
            // MessagesScreen 顶部自定义会话 filter tab 整个会话都是空的。
          }
        } else {
          // 后端未返回 imToken，确保 IM 状态已清空
          await logoutFromOpenIM();
        }

        // 拉用户自定义会话分组（MessagesScreen 顶部 filter tab 需要）。
        // 失败不阻断登录跳转；store 内部已 dev-warn。
        void useMessageGroupsStore.getState().load();
      }

      // 登录页本身由根布局的 AuthRouteGuard 监听 session 状态并跳转。
      // 这里不再命令式 replace，避免和 <Redirect> 同帧竞争导致主页入栈两次。
    },
    [setSession],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      if (inFlightRef.current) return;
      safeSetError(null);
      const normalizedEmail = email.trim();

      const invalid = validateLoginForm(normalizedEmail, password);
      if (invalid) {
        safeSetError(i18n.t(invalid));
        return;
      }
      inFlightRef.current = true;
      safeSetSubmitting(true);
      try {
        const tokens = await loginRequest({ email: normalizedEmail, password });
        await onAuthSuccess(tokens);
      } catch (requestError) {
        await clearLocalSession();
        safeSetError(getApiErrorMessage(requestError, i18n.t('auth.errors.loginFailed')));
      } finally {
        inFlightRef.current = false;
        safeSetSubmitting(false);
      }
    },
    [onAuthSuccess, safeSetError, safeSetSubmitting],
  );

  const loginWithCode = useCallback(
    async (email: string, code: string) => {
      if (inFlightRef.current) return;
      safeSetError(null);
      const normalizedEmail = email.trim();
      const invalid = validateLoginCodeForm(normalizedEmail, code);
      if (invalid) {
        safeSetError(i18n.t(invalid));
        return;
      }
      inFlightRef.current = true;
      safeSetSubmitting(true);
      try {
        const tokens = await loginWithCodeRequest({
          email: normalizedEmail,
          code: code.trim(),
        });
        await onAuthSuccess(tokens);
      } catch (requestError) {
        await clearLocalSession();
        safeSetError(getApiErrorMessage(requestError, i18n.t('auth.errors.loginFailed')));
      } finally {
        inFlightRef.current = false;
        safeSetSubmitting(false);
      }
    },
    [onAuthSuccess, safeSetError, safeSetSubmitting],
  );

  const register = useCallback(
    async (
      email: string,
      code: string,
      password: string,
      nickname: string,
      inviteCode = '',
    ) => {
      if (inFlightRef.current) return;
      safeSetError(null);
      const normalizedEmail = email.trim();
      const invalid = validateRegisterForm(
        normalizedEmail,
        code,
        password,
        nickname,
        inviteCode,
      );
      if (invalid) {
        safeSetError(i18n.t(invalid));
        return;
      }

      inFlightRef.current = true;
      safeSetSubmitting(true);
      try {
        const normalizedInviteCode = inviteCode.trim();
        const tokens = await registerRequest({
          email: normalizedEmail,
          code: code.trim(),
          password,
          nickname: nickname.trim(),
          ...(normalizedInviteCode
            ? { inviteCode: normalizedInviteCode }
            : {}),
        });
        await onAuthSuccess(tokens, {
          onboardingRequired: true,
          startAppServices: false,
        });
      } catch (requestError) {
        safeSetError(getApiErrorMessage(requestError, i18n.t('auth.errors.registerFailed')));
      } finally {
        inFlightRef.current = false;
        safeSetSubmitting(false);
      }
    },
    [onAuthSuccess, safeSetError, safeSetSubmitting],
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
    }
  }, [safeSetError, safeSetSubmitting]);

  const logout = useCallback(async () => {
    // 退出 = 从本设备账号列表移除当前账号（下次需重新登录才能回来）。
    const currentId = useAuthStore.getState().user?.id;
    if (currentId) {
      useKnownAccountsStore.getState().removeAccount(currentId);
    }
    await endSession();
  }, [endSession]);

  // 「切换账号」打开账号选择 sheet，而不是直接登出。
  const switchAccount = useCallback(() => {
    useAccountSwitcherStore.getState().open();
  }, []);

  // 切到一个已登录过的账号：拆掉当前会话 → 用存的 token 激活 → 校验 session。
  // session 仍有效（含 401 自动续期）则直接进入；已过期则移除并跳登录页预填账号。
  const switchToAccount = useCallback(
    async (account: KnownAccount) => {
      if (inFlightRef.current) return;
      if (useAuthStore.getState().user?.id === account.user.id) {
        useAccountSwitcherStore.getState().close();
        return;
      }

      safeSetError(null);
      inFlightRef.current = true;
      safeSetSubmitting(true);
      try {
        // teardown 当前账号（IM 登出、清空依赖 store、清持久化会话）。
        await clearLocalSession();

        // 先用存储的资料乐观激活，UI 立即切到目标账号。
        setSession(
          {
            accessToken: account.accessToken,
            refreshToken: account.refreshToken,
            imToken: account.imToken,
          },
          account.user,
        );

        // 校验 session：/auth/me 命中 401 时 apiClient 会用 refreshToken 自动续期；
        // 续期失败会清本地会话并抛错，落入下方过期分支。
        const user = await retry(() => fetchCurrentUser());
        useAuthStore.getState().setUser(user);

        // 续期可能换了新 token，把最新值写回账号列表。
        const { accessToken, refreshToken, imToken } = useAuthStore.getState();
        if (accessToken && refreshToken) {
          useKnownAccountsStore.getState().upsertAccount({
            user,
            accessToken,
            refreshToken,
            imToken: imToken ?? null,
            updatedAt: Date.now(),
          });
        }

        if (imToken) {
          try {
            await loginToOpenIM(user.id, imToken);
          } catch (imError) {
            console.warn(
              '[openim] login failed',
              imError instanceof Error ? imError.message : imError,
            );
          }
        } else {
          await logoutFromOpenIM();
        }

        void useMessageGroupsStore.getState().load();

        useAccountSwitcherStore.getState().close();
        router.replace('/(tabs)/messages');
      } catch (switchError) {
        // 只有服务端明确否认凭证（401/403，含刷新失败）才算「session 已过期」——
        // 移除死账号，跳登录页并预填账号 id。后端重启 / 掉网 / 5xx 时删账号
        // 等于把一个好账号连同当前会话一起炸掉（#101）。
        if (isDefinitiveAuthFailure(switchError)) {
          useKnownAccountsStore.getState().removeAccount(account.user.id);
          await clearLocalSession();
          useAccountSwitcherStore.getState().close();
          if (isDev) {
            console.warn('[auth] switch account failed (session expired)', switchError);
          }
          router.replace({
            pathname: '/(auth)/login',
            params: { email: account.user.email ?? '' },
          });
        } else {
          // 瞬时失败：目标账号 token 已乐观激活（上面 setSession），与冷启动
          // 同哲学 —— 带着快照进 app，后续请求自然重试；账号列表保持完整。
          // review 修复①：/auth/me 的 401 前置续期可能已轮换 token —— 降级
          // 进入前把 auth store 里的最新值写回账号列表，否则切走再切回会拿
          // 旧 refreshToken 撞 401，把一个好账号误判成死账号移除。
          const { accessToken, refreshToken, imToken } =
            useAuthStore.getState();
          if (accessToken && refreshToken) {
            useKnownAccountsStore.getState().upsertAccount({
              user: account.user,
              accessToken,
              refreshToken,
              imToken: imToken ?? null,
              updatedAt: Date.now(),
            });
          }
          // review 修复②：clearLocalSession 已把 OpenIM 登出，而 setSession
          // 置 isLoading=false 后 SessionBootstrap 不再补 IM 登录 —— 降级进入
          // 也要用快照 imToken 尽力重连 + 拉会话分组；失败走 token-recovery
          // 的回前台欠账路径，不阻塞导航。
          if (imToken) {
            const recoveryGenerationBefore = getIMRecoveryGeneration();
            try {
              await loginToOpenIM(account.user.id, imToken);
            } catch (imError) {
              console.warn(
                '[openim] degraded-switch login failed',
                imError instanceof Error ? imError.message : imError,
              );
              // round 2 review：降级进入时 /auth/me 在瞬断，这次 IM 登录多半
              // 也会挂 —— 只 warn 的话 bootstrap 已被 setSession 短路、没人
              // 再补登，IM 断连到重启。挂进与 bootstrap 共享的补登欠账，
              // 回前台时由它的前台监听自动重试。
              // 但登录期间被踢下线(多端顶替,代次已变)时不能再挂欠账,否则回前台又重登互踢。
              if (getIMRecoveryGeneration() === recoveryGenerationBefore) {
                markIMLoginRetryPending();
              }
            }
            void useMessageGroupsStore.getState().load();
          }
          useAccountSwitcherStore.getState().close();
          if (isDev) {
            console.warn('[auth] switch account degraded (transient)', switchError);
          }
          router.replace('/(tabs)/messages');
        }
      } finally {
        inFlightRef.current = false;
        safeSetSubmitting(false);
      }
    },
    [router, setSession, safeSetError, safeSetSubmitting],
  );

  return {
    login,
    loginWithCode,
    register,
    logout,
    switchAccount,
    switchToAccount,
    submitting,
    error,
    isAuthenticated,
    isLoading,
  };
}
