import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { markNotificationRead } from '@/services/api/notifications';
import { Radius, Spacing, useTheme } from '@/theme';
import { mapNotificationToRow } from '@/features/notifications/utils/notification-summary';
import { getSnackbarRoute } from '@/features/notifications/utils/snackbar-route';
import { useNotificationFeedback } from '@/features/notifications/hooks/use-notification-feedback';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';

const AUTO_DISMISS_MS = 4_000;
const ENTER_MS = 220;
const EXIT_MS = 180;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export function NotificationSnackbarHost() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const { colors } = useTheme();
  const { t } = useTranslation();
  // `current` is the store's queue head; `shown` is what's actually on screen.
  // Decoupling them lets us animate the outgoing banner out before swapping in
  // the next one, instead of unmounting instantly.
  const current = useNotificationSnackbarStore((state) => state.current);
  const dismissCurrent = useNotificationSnackbarStore(
    (state) => state.dismissCurrent,
  );

  // True when the user is already looking at the conversation list — a chat
  // toast there is redundant, so we skip past it.
  const onMessagesList = segments[segments.length - 1] === 'messages';

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
  const onMessagesListRef = useRef(onMessagesList);
  onMessagesListRef.current = onMessagesList;

  const isVisible = useCallback(
    (item: typeof shown) =>
      !!item && !(item.kind === 'chat' && onMessagesListRef.current),
    [],
  );

  // Swap effect: when the queue head changes, animate the current banner out
  // (if it was visible) and then promote the new head.
  useEffect(() => {
    if (current === shown) return;

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
  }, [current, shown, anim, isVisible]);

  // Entrance + auto-dismiss effect, keyed on what's actually shown.
  useEffect(() => {
    if (!shown) return;

    if (shown.kind === 'chat' && onMessagesListRef.current) {
      dismissCurrent();
      return;
    }

    anim.setValue(0);
    dragY.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: ENTER_MS,
      useNativeDriver: true,
    }).start();
    notify();

    timerRef.current = setTimeout(dismissCurrent, AUTO_DISMISS_MS);
    return clearTimer;
  }, [shown, dismissCurrent, anim, dragY, clearTimer, notify]);

  const row = useMemo(
    () => {
      if (!shown) return null;
      if (shown.kind === 'chat') {
        return {
          avatarName: shown.title,
          avatarUrl: shown.avatarUrl,
          title: shown.title,
          summary: shown.summary,
          icon: 'chatbubble-outline' as const,
        };
      }
      return mapNotificationToRow(shown, t);
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
      void markNotificationRead(shown.id).catch((error) => {
        if (isDev) {
          console.warn('[NotificationSnackbarHost] mark read failed', error);
        }
      });
    }

    router.push(
      getSnackbarRoute(shown, {
        untitledPost: t('notifications.signupMgmt.untitledPost'),
      }),
    );
  }, [shown, clearTimer, dismissCurrent, router, t]);

  if (!shown || !row || (shown.kind === 'chat' && onMessagesList)) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[s.host, { paddingTop: insets.top + Spacing.sm }]}
    >
      <Animated.View
        {...pan.panHandlers}
        style={{
          opacity: anim,
          transform: [
            {
              translateY: Animated.add(
                anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-12, 0],
                }),
                dragY,
              ),
            },
          ],
        }}
      >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.title}. ${row.summary}`}
        onPress={handlePress}
        style={[
          s.banner,
          {
            backgroundColor: colors.surface,
            borderColor: colors.surfaceBorder,
            shadowColor: colors.black,
          },
        ]}
      >
        <Avatar size={38} name={row.avatarName} uri={row.avatarUrl ?? undefined} />
        <View style={s.textBlock}>
          <Text style={[s.title, { color: colors.text }]} numberOfLines={1}>
            {row.title}
          </Text>
          <Text
            style={[s.summary, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {row.summary}
          </Text>
        </View>
        <Ionicons name={row.icon} size={20} color={colors.primary} />
      </Pressable>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingHorizontal: Spacing.md,
  },
  banner: {
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  summary: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
  },
});
