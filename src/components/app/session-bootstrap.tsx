import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { fetchCurrentUser } from '@/services/api/auth';
import { isDefinitiveAuthFailure } from '@/services/api/client';
import { loginToOpenIM, logoutFromOpenIM } from '@/im/client';
import { isOpenIMTokenRejectedError } from '@/im/token-errors';
import { isIMReloginPending, recoverIMSession } from '@/im/token-recovery';
import {
  clearIMLoginRetryPending,
  isIMLoginRetryPending,
  markIMLoginRetryPending,
} from '@/im/login-retry-pending';
import {
  connectRealtime,
  disconnectRealtime,
  recoverTabBadgeSnapshot,
} from '@/realtime/client';
import { clearLocalSession } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { hasCompletedOnboardingProfile } from '@/features/auth/onboarding-completion';
import { retry } from '@/utils/retry';

/**
 * SessionBootstrap — 无 UI 的启动引导组件，挂载在 app 根节点。
 *
 * 职责：
 * 1. 注册 OpenIM SDK 全局事件监听器（连接状态、新消息等）
 * 2. 在 authStore 从 AsyncStorage 完成 hydration 后，自动恢复登录态：
 *    - 有 token → 请求 /auth/me 获取用户信息 → 用 imToken 登录 OpenIM
 *    - 无 token / 服务端明确否认凭证（401、403）→ 清除 session，由 app/index.tsx 跳转登录页
 *    - 瞬时失败（网络不可达 / 超时 / 5xx）→ 保留 session，用持久化的 user 快照补登 OpenIM，
 *      仍失败则记下欠账，等 app 回前台再补（见 recoverOpenIMLogin）
 *
 * 该组件始终返回 null，不渲染任何 UI。
 */
export function SessionBootstrap() {
  // selector 化：避免订阅整个 authStore —— SessionBootstrap 返回 null，但任意 auth
  // 字段变化都会让组件重新执行（重跑 useEffect 依赖比较），尤其是 token 刷新场景。
  const accessToken = useAuthStore((state) => state.accessToken);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const imToken = useAuthStore((state) => state.imToken);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const onboardingRequired = useAuthStore((state) => state.onboardingRequired);
  const setUser = useAuthStore((state) => state.setUser);
  const setLoading = useAuthStore((state) => state.setLoading);
  const setOnboardingRequired = useAuthStore(
    (state) => state.setOnboardingRequired,
  );

  // OpenIM 全局事件由 ensureOpenIMInitialized() 在 initSDK 之前主动绑定，
  // 这里不再额外绑定 —— 否则 SessionBootstrap 卸载时会意外解绑全部 listener。

  // 是否还欠着一次 OpenIM 登录：round 2 review 后提升为模块级标记
  //（src/im/login-retry-pending.ts）—— 欠账的生产者不止 bootstrap 自己，
  // 降级切号（use-auth）也会在 IM 登录失败时 mark，一处消费统一重试。
  //
  // 幂等的 OpenIM 登录。loginToOpenIM 内部会先查 getLoginStatus、并把 10102
  // 「重复登录」当作成功，所以重复调用是安全的 —— 这正是「补登」能成立的前提。
  // 失败只记欠账、不外抛：IM 掉线不该阻断 app 主流程。
  const ensureOpenIMLogin = useCallback(async (userId: string, token: string) => {
    try {
      await loginToOpenIM(userId, token);
      clearIMLoginRetryPending();
    } catch (error) {
      if (isOpenIMTokenRejectedError(error)) {
        // 缓存的 imToken 已被服务端拒绝（1501-1506）——重试同一枚没有意义，
        // 改走 GET /auth/im-token 换新 token 原地重登（#83）。欠账由
        // token-recovery 模块自己记（isIMReloginPending），这里不再重复记。
        clearIMLoginRetryPending();
        void recoverIMSession();
        return;
      }
      // 含连接就绪超时(CONNECTION_NOT_READY)在内的其它失败：token 仍有效，换 token
      // 反而会强制登出还在连接中的 SDK、弱网下空转成环。留着欠账，回前台用同一枚
      // token 重试 —— 那时网络多半已经恢复。
      markIMLoginRetryPending();
      console.warn(
        '[openim] login failed; will retry on next foreground',
        error instanceof Error ? error.message : error
      );
    }
  }, []);

  // 用 store 里（已持久化 + 水合）的 user 快照补一次 OpenIM 登录。
  //
  // 为什么需要它：bootstrap 是冷启动唯一登录 OpenIM 的地方。/auth/me 瞬时失败后
  // session 被保住了（正确），但流程也就此中断 —— IM 会一直保持登出，消息一路降级
  // 到用户手动重启 app。比「被登出」好，但仍是实打实的降级。
  //
  // 为什么只读不写：路由只认 isAuthenticated / onboardingRequired / isLoading
  // （见 app/index.tsx 与 auth-route-policy.ts），这里刻意不碰 setUser /
  // setOnboardingRequired —— 拿一份可能过期的快照去改路由输入，正是 authStore
  // 注释里反复记录过的「onboarding 被弹回」那类 bug。为了修一个降级的 IM 而冒
  // 把用户路由错的风险，不划算。
  const recoverOpenIMLogin = useCallback(async () => {
    const {
      user: cachedUser,
      imToken: cachedImToken,
      onboardingRequired: onboardingPending,
    } = useAuthStore.getState();

    // onboarding 未完成时成功路径本就不登录 IM，降级路径保持同样的门禁。
    if (onboardingPending || !cachedUser) {
      return;
    }

    // 快照里根本没有 imToken（#85）：重试缓存路径永远无货可用，
    // 直接向后端换一枚新 IM token 补登。
    if (!cachedImToken) {
      await recoverIMSession();
      return;
    }

    await ensureOpenIMLogin(cachedUser.id, cachedImToken);
  }, [ensureOpenIMLogin]);

  useEffect(() => {
    if (!hasHydrated || onboardingRequired) {
      disconnectRealtime();
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
  }, [accessToken, hasHydrated, onboardingRequired]);

  useEffect(() => {
    if (!hasHydrated || onboardingRequired) {
      return;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }

      const { accessToken: nextAccessToken, onboardingRequired: nextOnboardingRequired } =
        useAuthStore.getState();
      if (nextOnboardingRequired) {
        return;
      }
      if (!nextAccessToken) {
        disconnectRealtime();
        return;
      }

      connectRealtime(nextAccessToken);
      void recoverTabBadgeSnapshot();

      // 冷启动欠下的 IM 登录在这里补。回前台是个现成的信号（网络多半已恢复），
      // 既不用轮询、也不用额外的退避循环 —— 重试次数天然被用户的前台次数兜住。
      // 健康会话两个 pending 恒为 false，这里是零成本 no-op。
      // union：补登欠账走 #121 的模块级标记；token-recovery 欠账走 #120 的
      // isIMReloginPending —— 两套欠账互补（普通登录失败 vs 换 token 失败）。
      if (isIMLoginRetryPending()) {
        void recoverOpenIMLogin();
      } else if (isIMReloginPending()) {
        // token-recovery 模块欠的那次（换新 token 失败 / 新 token 登录失败）在这里补。
        void recoverIMSession();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [hasHydrated, onboardingRequired, recoverOpenIMLogin]);

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
        // 用当前 accessToken 请求后端获取用户信息。
        // 这条路径在每次冷启动都跑：一次瞬时网络失败就把本地 session 全清是过激的，
        // 包一层 retry —— 网络 / 5xx 静默重试一次；401 / 403 才走 clearLocalSession。
        const user = await retry(() => fetchCurrentUser());

        if (cancelled) {
          return;
        }

        setUser(user);

        if (onboardingRequired && !hasCompletedOnboardingProfile(user)) {
          return;
        }

        if (onboardingRequired) {
          setOnboardingRequired(false);
        }

        if (imToken) {
          // 失败不阻断主流程，但会记下欠账 —— 冷启动这一次登录失败同样不该让 IM
          // 降级一整个会话，回前台时会补。
          await ensureOpenIMLogin(user.id, imToken);
        } else {
          // 没有 imToken：先确保 IM 状态干净，再向后端换一枚新 IM token 原地补登
          // （#85 —— 旧行为是整个会话生命周期都放弃 IM）。不 await：
          // 换 token 走网络，失败也只是记欠账回前台再补，不该拖慢启动。
          await logoutFromOpenIM();
          void recoverIMSession();
        }

        // 用户面板已就绪后再拉自定义会话分组；失败不阻断主流程（store 内部已 dev-warn）。
        // MessagesScreen 的顶部 filter tab 依赖这份数据。
        void useMessageGroupsStore.getState().load();
      } catch (error) {
        if (cancelled) {
          return;
        }

        // 只有服务端明确否认凭证（401 / 403，含刷新失败）才清 session 跳登录页。
        // 网络不可达 / 超时 / 5xx 只是「这一刻够不到服务器」——在地铁里冷启动一次
        // 不该等于登出：保留磁盘上的 token 与上一次的 user 快照（authStore 已持久化），
        // app 照常进入，后续请求自然会重试。
        if (isDefinitiveAuthFailure(error)) {
          await clearLocalSession();
          return;
        }

        // session 活着 ≠ 消息能用：上面 return 掉的正是唯一那次 OpenIM 登录。
        // 用持久化的 user 快照补登（纯读，不碰路由输入）。
        await recoverOpenIMLogin();
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
    ensureOpenIMLogin,
    hasHydrated,
    imToken,
    isLoading,
    onboardingRequired,
    recoverOpenIMLogin,
    refreshToken,
    setLoading,
    setOnboardingRequired,
    setUser,
  ]);

  return null;
}
