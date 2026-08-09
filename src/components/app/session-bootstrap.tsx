import { useEffect } from 'react';
import { AppState } from 'react-native';
import { fetchCurrentUser } from '@/services/api/auth';
import { isDefinitiveAuthFailure } from '@/services/api/client';
import {
  connectChat,
  disconnectChat,
  suspendChat,
} from '@/chat-core/socket-manager';
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
 * 职责：在 authStore 从 AsyncStorage 完成 hydration 后，自动恢复登录态：
 * - 有 token → 请求 /auth/me 获取用户信息，并建立 realtime + chat 长连接
 *   （自研 chat 复用 app JWT，无独立 IM token；断线重连由 socket-manager 自理）
 * - 无 token / 服务端明确否认凭证（401、403）→ 清除 session，由 app/index.tsx 跳转登录页
 * - 瞬时失败（网络不可达 / 超时 / 5xx）→ 保留 session，app 照常进入，后续请求自然重试
 *
 * 该组件始终返回 null，不渲染任何 UI。
 */
export function SessionBootstrap() {
  // selector 化：避免订阅整个 authStore —— SessionBootstrap 返回 null，但任意 auth
  // 字段变化都会让组件重新执行（重跑 useEffect 依赖比较），尤其是 token 刷新场景。
  const accessToken = useAuthStore((state) => state.accessToken);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const onboardingRequired = useAuthStore((state) => state.onboardingRequired);
  // 订阅到 id 这一级:整个 user 对象每次 setUser 都是新引用,会白白重连。
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const setUser = useAuthStore((state) => state.setUser);
  const setLoading = useAuthStore((state) => state.setLoading);
  const setOnboardingRequired = useAuthStore(
    (state) => state.setOnboardingRequired,
  );

  useEffect(() => {
    if (!hasHydrated || onboardingRequired || !accessToken) {
      disconnectRealtime();
      return;
    }

    connectRealtime(accessToken);
    return () => {
      disconnectRealtime();
    };
  }, [accessToken, hasHydrated, onboardingRequired]);

  /**
   * chat 连接单独一个 effect,而且**订阅** userId。
   *
   * 原来它和 realtime 合在一起,用 getState() 读一次 user —— 于是冷启动时
   * 「安全存储里的 token 还在、单独持久化的 user 快照丢了或是旧的」这种状态下:
   * 快照缺失 → 压根不连,而 /auth/me 成功后只调 setUser,本 effect 不重跑,
   * 要等一次切前后台才补上;快照是上一个账号 → 用错身份连上,收发方向与未读
   * 全按错的 currentUserId 算。
   * 拆开是为了不让 userId 的变化连带把 realtime 也断开重连一次。
   */
  useEffect(() => {
    if (!hasHydrated || onboardingRequired || !accessToken) {
      disconnectChat();
      return;
    }
    // 还没有权威用户:先不连。/auth/me 落地后 userId 变化会让本 effect 重跑。
    if (!userId) return;

    connectChat(accessToken, userId);
    return () => {
      // 这里必须是「挂起」而不是「登出」:access token 轮换也会让本 effect 重跑,
      // 清 store 的话正在看的会话会当场变空 —— 它的历史加载 effect 不依赖 token,
      // 不会重拉,要退出重进才恢复,pending 已读也一并丢了。
      // 换账号由 connectChat 自己识别并清 store。
      suspendChat();
    };
  }, [accessToken, hasHydrated, onboardingRequired, userId]);

  useEffect(() => {
    if (!hasHydrated || onboardingRequired) {
      return;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }

      const {
        accessToken: nextAccessToken,
        onboardingRequired: nextOnboardingRequired,
      } = useAuthStore.getState();
      if (nextOnboardingRequired) {
        return;
      }
      if (!nextAccessToken) {
        disconnectRealtime();
        disconnectChat();
        return;
      }

      connectRealtime(nextAccessToken);
      // 回前台补一次 chat 连接:connectChat 对「已连着且就是这个人」是 no-op,
      // 断线时触发重连,身份对不上时换成正确身份重连。
      const { user: nextUser } = useAuthStore.getState();
      if (nextUser?.id) {
        connectChat(nextAccessToken, nextUser.id);
      }
      void recoverTabBadgeSnapshot();
    });

    return () => {
      subscription.remove();
    };
  }, [hasHydrated, onboardingRequired]);

  // 在 store hydration 完成、且仍处于 loading 状态时执行一次会话恢复
  // isLoading 初始值为 true，bootstrap 完成后（无论成功/失败）通过 finally 置为 false
  useEffect(() => {
    if (!hasHydrated || !isLoading) {
      return;
    }

    // cancelled 标志用于防止组件卸载后继续写入 store
    let cancelled = false;

    const bootstrapSession = async () => {
      // 没有 token，直接结束 loading
      if (!accessToken || !refreshToken) {
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
        // app 照常进入，后续请求自然会重试。chat 长连接由上面的 effect 独立建立，
        // 不依赖本次 /auth/me 成功。
        if (isDefinitiveAuthFailure(error)) {
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
    isLoading,
    onboardingRequired,
    refreshToken,
    setLoading,
    setOnboardingRequired,
    setUser,
  ]);

  return null;
}
