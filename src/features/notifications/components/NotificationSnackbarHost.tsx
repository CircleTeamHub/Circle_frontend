import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalSearchParams, usePathname, useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/chat-core/store';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import {
  TopBannerCard,
  topBannerHiddenOffset,
  topBannerSurface,
} from '@/components/ui/top-banner-card';
import { markNotificationRead } from '@/services/api/notifications';
import { Spacing, useTheme } from '@/theme';
import { mapNotificationToRow } from '@/features/notifications/utils/notification-summary';
import {
  getSnackbarRoute,
  isUserProfileSnackbarRoute,
} from '@/features/notifications/utils/snackbar-route';
import { useNotificationFeedback } from '@/features/notifications/hooks/use-notification-feedback';
import {
  circleSoundAllowed,
  useCircleNotificationStore,
} from '@/features/discover/store/use-circle-notification-store';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { decrementUnreadBadgesFor } from '@/features/notifications/utils/unread-badges';
import {
  snackbarBannerKey,
  useNotificationSnackbarStore,
} from '@/features/notifications/store/use-notification-snackbar-store';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import { reportHandledFailure } from '@/observability/report-failure';
import { useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import { isCurrentRoute } from '@/utils/current-route';

import { getUserProfileScopeFromSegments } from '@/features/user/utils/routes';
const AUTO_DISMISS_MS = 4_000;
const ENTER_MS = 220;
const EXIT_MS = 180;
const s = StyleSheet.create({ emphasis: { fontWeight: '600' } });
export function NotificationSnackbarHost() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const { colors } = useTheme();
  const { t } = useTranslation();
  // `current` is the store's queue head; `shown` is what's actually on screen.
  // Decoupling them lets us animate the outgoing banner out before swapping in
  // the next one, instead of unmounting instantly.
  const current = useNotificationSnackbarStore((state) => state.current);
  const dismissCurrent = useNotificationSnackbarStore(
    (state) => state.dismissCurrent,
  );
  const notificationSettings = useAppSettingsStore(state => state.settings);
  useEffect(() => {
    useNotificationSnackbarStore.getState().pruneDisabled();
  }, [notificationSettings]);

  const activeConversationId = useChatStore((state) => state.activeConversationId);
  // 半屏聊天和盖在它上面的页面都在根上,segments 里没有 tab:沿用半屏记下的来源 tab,
  // 否则开着半屏再点一条横幅,来源 tab 就丢成消息栈了。
  const onChatSheet = segments[0] === 'quick-chat' || segments[0] === 'chat-sheet';
  const notificationScope = getUserProfileScopeFromSegments(
    onChatSheet ? [typeof params.originScope === 'string' ? params.originScope : ''] : segments,
  );

  const [shown, setShown] = useState(current);

  const notify = useNotificationFeedback();

  const anim = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Swipe-up-to-dismiss so the user can clear a banner without being forced to
  // navigate by tapping it. dismissCurrent / clearTimer are stable store/ref
  // callbacks, so capturing them once in the responder is safe.
  const pan = useRef(
    PanResponder.create({
      // Only claim clearly-vertical upward drags — taps still reach the Pressable.
      onMoveShouldSetPanResponder: (_evt, g) =>
        g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_evt, g) => {
        if (g.dy < 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_evt, g) => {
        if (g.dy < -40) {
          clearTimer();
          Animated.timing(dragY, {
            toValue: -140,
            duration: 150,
            useNativeDriver: true,
          }).start(() => {
            dragY.setValue(0);
            dismissCurrent();
          });
        } else {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  // Read the latest route inside effects without making them depend on it —
  // otherwise navigating mid-banner would re-run the entrance effect (re-animate,
  // reset the auto-dismiss timer, re-fire the sound).
  const activeConversationRef = useRef(activeConversationId);
  activeConversationRef.current = activeConversationId;

  useEffect(() => {
    if (current?.kind === 'chat' && current.conversationID === activeConversationId) {
      clearTimer();
      dismissCurrent();
    }
  }, [current, activeConversationId, clearTimer, dismissCurrent]);

  const isVisible = useCallback(
    (item: typeof shown) =>
      !!item && !(item.kind === 'chat' && item.conversationID === activeConversationRef.current),
    [],
  );

  // Swap effect: when the queue head changes, animate the current banner out
  // (if it was visible) and then promote the new head.
  useEffect(() => {
    if (current === shown) return;

    // 还是这一格横幅,只是同一会话来了新消息:直接换内容,不走退场再进场。
    if (current && shown && snackbarBannerKey(current) === snackbarBannerKey(shown)) {
      setShown(current);
      return;
    }

    if (!isVisible(shown)) {
      setShown(current);
      return;
    }

    Animated.timing(anim, {
      toValue: 0,
      duration: EXIT_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShown(current);
    });
    // activeConversationId 也要触发:点横幅进它的会话时,退场动画还在播,宿主就不再渲染
    // 这条横幅了。原生驱动的动画随视图卸下被打断,上面的回调拿不到 finished,换不过去;
    // 返回列表后这条旧横幅会以半截位置重新冒出来、计时器早已走完,再也不收(实机截图)。
    // 当前会话一变就重跑:横幅已看不见,走上面的分支直接换下一条。
  }, [current, shown, anim, isVisible, activeConversationId]);

  // Entrance + auto-dismiss effect, keyed on which banner is shown — not on its
  // content: a newer message replacing the banner on screen must not re-animate,
  // re-play the sound or restart the auto-dismiss timer.
  const shownKey = shown ? snackbarBannerKey(shown) : null;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    const item = shownRef.current;
    if (!item || shownKey === null) return;

    if (item.kind === 'chat' && item.conversationID === activeConversationRef.current) {
      return;
    }

    anim.setValue(0);
    dragY.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: ENTER_MS,
      useNativeDriver: true,
    }).start();
    // 圈子通知的提示音由「圈子通知设置 → 声音提醒」单独控制；关掉只静音，
    // 横幅和未读红点照常。免打扰的会话根本不进横幅（见 chat-core/dispatcher）。
    const silent =
      item.kind === 'notification' &&
      item.type.startsWith('CIRCLE_') &&
      !circleSoundAllowed(useCircleNotificationStore.getState());
    notify({ silent, kind: item.kind === 'notification' && item.type.startsWith('CIRCLE_') ? 'circle' : 'message' });

    timerRef.current = setTimeout(dismissCurrent, AUTO_DISMISS_MS);
    return clearTimer;
  }, [shownKey, dismissCurrent, anim, dragY, clearTimer, notify]);

  const row = useMemo(
    () => {
      if (!shown) return null;
      if (shown.kind === 'chat') {
        const mention = shown.mentioned
          ? t('chat.snackbarMentionedMe', { defaultValue: '[有人@我]' })
          : '';
        const sender = shown.senderName ? `${shown.senderName}: ` : '';
        return {
          avatarName: shown.title,
          avatarUrl: shown.avatarUrl,
          title: shown.title,
          // 读屏念整句;界面上分段着色(见下面的正文)。
          summary: `${mention ? `${mention} ` : ''}${sender}${shown.summary}`,
          chat: {
            group: shown.conversationType === 'group',
            temporary: shown.temporary === true,
            mention,
            sender,
            body: shown.summary,
          },
        };
      }
      return { ...mapNotificationToRow(shown, t), chat: null };
    },
    [shown, t],
  );

  const handlePress = useCallback(() => {
    if (!shown) return;

    clearTimer();
    dismissCurrent();

    if (shown.kind === 'notification') {
      // Optimistically mark read locally so the notification center reflects
      // the tap immediately, regardless of the network call's outcome.
      useNotificationCenterStore.getState().markInteractiveReadLocal(shown.id);
      if (!shown.read) decrementUnreadBadgesFor(shown.type);
      void markNotificationRead(shown.id).catch((error) => {
        reportHandledFailure('notifications', 'markRead', error);
      });
    }
    logClientDiagnostic('notification_open', {
      source: shown.kind === 'chat' ? 'chat_snackbar' : 'notification_snackbar',
      notificationId: shown.id,
    });

    const route = getSnackbarRoute(shown, {
      untitledPost: t('notifications.signupMgmt.untitledPost'),
      scope: notificationScope,
    });
    // 聊天横幅点开是半屏聊天:当场回复,不用离开手上的页面(比如正在写笔记)。用户可以在通知设置里关掉。
    // 已经在消息列表时没有要留住的页面,直接进完整聊天。
    const onMessageList = segments.length === 2 && segments[0] === '(tabs)' && segments[1] === 'messages';
    if (notificationSettings.quickChatSheet && !onMessageList && shown.kind === 'chat' && typeof route === 'object' && 'params' in route) {
      // 记下横幅下面是哪个 tab:点「展开」时在那个栈里打开完整聊天,返回回到原页面。
      router.push({
        pathname: '/quick-chat',
        params: { ...route.params, originScope: notificationScope },
      });
      return;
    }
    // 正看着的就是横幅指向的那一页（如报名列表开着时又来一条报名）：原地换成新的，
    // 刷出新数据，不再压一层 —— 否则返回时还是这一页。
    if (isCurrentRoute({ pathname, params }, route)) {
      router.replace(route);
    } else if (isUserProfileSnackbarRoute(route)) {
      router.navigate(route);
    } else {
      router.push(route);
    }
  }, [shown, clearTimer, dismissCurrent, notificationScope, notificationSettings.quickChatSheet, pathname, params, router, segments, t]);

  if (!shown || !row || (shown.kind === 'chat' && shown.conversationID === activeConversationId)) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[topBannerSurface.host, { paddingTop: insets.top + Spacing.sm }]}
    >
      <Animated.View
        {...pan.panHandlers}
        // 只做位移不做淡入：卡片是玻璃材质，祖先 opacity < 1 会让磨砂失效。
        style={[
          topBannerSurface.frame,
          {
            transform: [
              {
                translateY: Animated.add(
                  anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [topBannerHiddenOffset(insets.top), 0],
                  }),
                  dragY,
                ),
              },
            ],
          },
        ]}
      >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.title}. ${row.summary}`}
        onPress={handlePress}
      >
        <TopBannerCard>
          {/* 群聊用会话列表同款群头像(「多人」角标 / 临时群金色时钟),一眼和私聊分开。 */}
          {row.chat?.group ? (
            <GroupChatAvatar
              size={36}
              name={row.avatarName}
              uri={row.avatarUrl}
              temporary={row.chat.temporary}
              showGroupBadge
              badgeBorderColor={colors.surface}
            />
          ) : (
            <Avatar size={36} name={row.avatarName} uri={row.avatarUrl ?? undefined} />
          )}
          <View style={topBannerSurface.textBlock}>
            <Text style={[topBannerSurface.title, { color: colors.text }]} numberOfLines={1}>
              {row.title}
            </Text>
            <Text
              style={[topBannerSurface.summary, { color: colors.textSecondary }]}
              numberOfLines={2}
            >
              {row.chat ? (
                <>
                  {row.chat.mention ? (
                    <Text style={[s.emphasis, { color: colors.danger }]}>{`${row.chat.mention} `}</Text>
                  ) : null}
                  {row.chat.sender ? (
                    <Text style={[s.emphasis, { color: colors.text }]}>{row.chat.sender}</Text>
                  ) : null}
                  {row.chat.body}
                </>
              ) : (
                row.summary
              )}
            </Text>
          </View>
        </TopBannerCard>
      </Pressable>
      </Animated.View>
    </View>
  );
}
