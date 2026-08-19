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
  // 朋友圈铃铛只算朋友圈的未读（动态点赞/评论/回复/@ + 资料点赞）。圈子的通知
  // 归广场页那个铃铛(domain=circle)，两边不互相报红点。
  const momentsUnread = useTabBadgeStore((state) => state.momentsUnread);

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
    router.push({
      pathname: '/(tabs)/discover/notification-center',
      params: { domain: 'moments' },
    });
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
              <Badge count={momentsUnread} />
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
