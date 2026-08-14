import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/ui/badge';
import { NavHeader } from '@/components/ui/nav-header';
import { MomentsFeed } from '@/features/discover/components/moments-feed';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { Radius, Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  notificationButton: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: -8,
    right: -12,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: 110,
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default function MomentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  // 发现页「朋友圈」那一行的红点读的就是它 —— 互动通知未读。红点必须能点到真正
  // 能看到、能清掉它的地方:铃铛中心的「互动」tab(默认 tab)。圈子通知的入口在
  // 广场页的铃铛(initialTab=circle)。
  const interactionUnread = useTabBadgeStore((state) => state.discoverUnread);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: colors.background,
      },
      fab: {
        backgroundColor: colors.primary,
      },
    }),
    [colors, insets.top],
  );

  const handleCreateMoment = useCallback(() => {
    router.push('/(tabs)/discover/create-moment');
  }, [router]);

  const handleOpenNotifications = useCallback(() => {
    router.push('/(tabs)/discover/notification-center');
  }, [router]);

  return (
    <View style={d.container}>
      <NavHeader
        title={t('discover.moments')}
        fallbackHref="/(tabs)/discover"
        rightSlot={
          <Pressable
            style={s.notificationButton}
            onPress={handleOpenNotifications}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('notifications.title')}
          >
            <Ionicons
              name="notifications-outline"
              size={22}
              color={colors.textSecondary}
            />
            <View style={s.notificationBadge}>
              <Badge count={interactionUnread} />
            </View>
          </Pressable>
        }
      />
      <View style={s.content}>
        <MomentsFeed />
      </View>
      <Pressable
        style={[s.fab, d.fab]}
        onPress={handleCreateMoment}
        accessibilityRole="button"
        accessibilityLabel={t('moment.createTitle')}
      >
        <Ionicons name="add" size={24} color={colors.white} />
      </Pressable>
    </View>
  );
}
