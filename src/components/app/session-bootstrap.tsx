import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchCurrentUser, fetchCurrentUserWithToken } from '@/services/api/auth';
import { isDefinitiveAuthFailure, restoreWebSessionAccessToken, type ApiError } from '@/services/api/client';
import { WEB_COOKIE_REFRESH_TOKEN, usesWebSessionCookie } from '@/services/auth/web-session';
import {
  connectChat,
  disconnectChat,
  setChatAppState,
  suspendChat,
  suspendChatForBackground,
} from '@/chat-core/socket-manager';
import { hasUnfinishedChatSends } from '@/chat-core/client';
import {
  connectRealtime,
  disconnectRealtime,
  recoverTabBadgeSnapshot,
} from '@/realtime/client';
import { clearLocalSession } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { hasCompletedOnboardingProfile } from '@/features/auth/onboarding-completion';
import { reportError } from '@/observability/sentry';
import { retry } from '@/utils/retry';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import { reportHandledFailure } from '@/observability/report-failure';
import { createHttpRequestId } from '@/observability/http-diagnostics';
import WebScreenReady from '@/observability/web-screen-ready';
import { createBackgroundDisconnect } from '@/components/app/background-disconnect';
import { Radius, Spacing, useTheme } from '@/theme';
import i18n from '@/i18n';

export function WebSessionRecovery({
  kind,
  onPress,
  pending = false,
}: {
  kind: 'unreachable' | 'invalidated';
  onPress: () => void;
  pending?: boolean;
}) {
  const { colors } = useTheme();
  const title = kind === 'invalidated'
    ? i18n.t('auth.webSessionInvalidatedTitle')
    : i18n.t('auth.webSessionUnreachableTitle');
  const message = kind === 'invalidated'
    ? i18n.t('auth.webSessionInvalidatedMessage')
    : i18n.t('auth.webSessionUnreachableMessage');
  const actionLabel = kind === 'invalidated'
    ? i18n.t('auth.webSessionReload')
    : i18n.t('common.retry', { defaultValue: '重试' });

  // 恢复页是一张能操作的页面，算启动完成；不然网页启动探针一分钟后会在它上面再叠一层面板。
  return (
    <WebScreenReady>
      <View style={[styles.recovery, { backgroundColor: colors.background }]}>
        <View style={styles.recoveryContent}>
          <Text accessibilityRole="header" style={[styles.recoveryTitle, { color: colors.text }]}>{title}</Text>
          <Text accessibilityRole="alert" style={[styles.recoveryMessage, { color: colors.textSecondary }]}>{message}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            accessibilityState={{ disabled: pending, busy: pending }}
            disabled={pending}
            onPress={onPress}
            style={({ pressed }) => [
              styles.recoveryAction,
              { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
              pressed && { opacity: 0.75 },
            ]}
          >
            {pending ? <ActivityIndicator size="small" color={colors.link} /> : null}
            <Text style={[styles.recoveryActionLabel, { color: colors.link }]}>{actionLabel}</Text>
          </Pressable>
        </View>
      </View>
    </WebScreenReady>
  );
}

const styles = StyleSheet.create({
  recovery: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  recoveryContent: { width: '100%', maxWidth: 400, alignItems: 'center', gap: Spacing.md },
  recoveryTitle: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  recoveryMessage: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
  recoveryAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
  },
  recoveryActionLabel: { fontSize: 16, fontWeight: '600' },
});

export function SessionBootstrap({ children }: { children?: ReactNode }) {
  const [{ retryCount, restoreStatus }, setWebRestore] = useState<{
    retryCount: number;
    restoreStatus: 'initial' | 'retrying' | 'unreachable';
  }>({ retryCount: 0, restoreStatus: 'initial' });
  const webRestoreAttemptId = useRef<string | null>(null);
  const webRestoreOwnerId = useRef<string | null | undefined>(undefined);
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

    // 安卓退到后台 JS 照跑、聊天长连接一直连着,每个群的每条消息都在后台处理一遍。
    // 离开超过 60 秒就断开聊天连接(挂起,不清数据),新消息交给推送;回前台下面照常
    // 重连对账。还有消息没发完(后台里视频还在传)就再等一轮。
    // 实时连接不断:来电邀请只走它、没有推送兜底,而它平时几乎没有流量。
    // iOS 系统约 30 秒就挂起 App,不需要这套。
    const backgroundDisconnect =
      Platform.OS === 'android'
        ? createBackgroundDisconnect({
            shouldStayConnected: hasUnfinishedChatSends,
            disconnect: suspendChatForBackground,
          })
        : null;
    // 本 effect 重跑(引导状态变化)会清掉上一轮的计时;已经在后台的话接着计。
    if (AppState.currentState === 'background') {
      backgroundDisconnect?.onBackground();
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      // 前后台都要告诉聊天连接:退到后台时服务端推送照发、本机不再把开着的
      // 会话当成「正在看」(否则锁屏期间的消息被悄悄标成已读)。inactive
      // (控制中心下拉、来电横幅)界面仍可见,不算后台。
      setChatAppState(nextState === 'background' ? 'background' : 'foreground');
      if (nextState === 'background') backgroundDisconnect?.onBackground();
      if (nextState !== 'active') {
        return;
      }
      backgroundDisconnect?.onForeground();

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
      backgroundDisconnect?.dispose();
    };
  }, [hasHydrated, onboardingRequired]);

  // 在 store hydration 完成、且仍处于 loading 状态时执行一次会话恢复
  // Web 恢复遇到暂时故障时仍保持 loading 和路由门禁，等待用户重试。
  useEffect(() => {
    if (!hasHydrated || !isLoading) {
      return;
    }

    // cancelled 标志用于防止组件卸载后继续写入 store
    let cancelled = false;

    const bootstrapSession = async () => {
      if (!accessToken || !refreshToken) {
        // 网页重新加载后没有内存凭证，先用 HttpOnly Cookie 续签。
        if (usesWebSessionCookie()) {
          if (webRestoreOwnerId.current === undefined) {
            webRestoreOwnerId.current = useAuthStore.getState().user?.id ?? null;
          }
          const ownerId = webRestoreOwnerId.current;
          try {
            // 未收到续签结果时，自动与手动重试都复用 ID，避免丢包后被判定为重放旧 Cookie。
            const attemptId = (webRestoreAttemptId.current ??= createHttpRequestId());
            const webAccessToken = await retry(() => restoreWebSessionAccessToken(attemptId));
            if (cancelled) return;
            webRestoreAttemptId.current = null;
            if (webAccessToken) {
              const user = await retry(() => fetchCurrentUserWithToken(webAccessToken));
              if (cancelled) return;
              const { invalidateWebSession, setSession } = useAuthStore.getState();
              if (ownerId && user.id !== ownerId) {
                // 停在重试页的旧标签页不能切换到新账号。重新加载后的新页面可以
                // 先清掉旧共享缓存，再使用已确认的当前会话；分账号的草稿仍然保留。
                if (retryCount > 0) {
                  invalidateWebSession();
                  return;
                }
                await clearLocalSession(undefined, {
                  preserveLoading: true,
                  preserveComposerDrafts: true,
                  reason: 'account-switch',
                });
                if (cancelled) return;
              }
              setSession({ accessToken: webAccessToken, refreshToken: WEB_COOKIE_REFRESH_TOKEN }, user);
              if (hasCompletedOnboardingProfile(user)) void useMessageGroupsStore.getState().load();
              return;
            }
          } catch (error) {
            if (cancelled) return;
            reportHandledFailure('session', 'restoreWebSession', error);
            if (!isDefinitiveAuthFailure(error)) {
              // 服务端暂时不可达时先保留本地草稿及缓存，由恢复页继续挡住路由。
              setWebRestore({ retryCount, restoreStatus: 'unreachable' });
              return;
            }
          }
        }
        // 确认没有可用会话后清除账号级缓存，避免下次登录时读到前一账号的数据。
        try {
          await clearLocalSession(undefined, {
            preserveLoading: true,
            reason: 'bootstrap-tokens-missing',
          });
        } catch (error) {
          reportError(error, {
            component: 'SessionBootstrap',
            operation: 'clearTokenlessSession',
            kind: 'cleanup-failed',
          });
        } finally {
          // 清理是 best-effort；即使某个懒加载的 store 清理失败，也不能把路由
          // 永久锁在启动页。
          if (!cancelled) {
            setLoading(false);
          }
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
          logClientDiagnostic('session.bootstrap.rejected', {
            reason: 'credentials_rejected',
          });
          const failure = error as ApiError;
          await clearLocalSession(undefined, {
            reason: 'bootstrap-rejected',
            endpointPath: '/auth/me',
            method: 'GET',
            status: failure.status,
            requestId: failure.requestId,
            failureKind: failure.failureKind,
          });
        } else {
          // 瞬时失败只留面包屑（ApiError 已由 api/client 决定过是否上报）；
          // 非 API 错误（存储 / 序列化）才会真的进 Sentry。
          reportHandledFailure('session', 'bootstrap', error);
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
    retryCount,
    setLoading,
    setOnboardingRequired,
    setUser,
  ]);

  if (isLoading && restoreStatus !== 'initial') {
    return (
      <WebSessionRecovery
        kind="unreachable"
        pending={restoreStatus === 'retrying'}
        onPress={() => setWebRestore((previous) => previous.restoreStatus === 'unreachable'
          ? { retryCount: previous.retryCount + 1, restoreStatus: 'retrying' }
          : previous)}
      />
    );
  }

  return children ?? null;
}
