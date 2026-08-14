import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/ui/badge';
import { NavHeader } from '@/components/ui/nav-header';
import { PlazaFeed } from '@/features/discover/components/plaza-feed';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { Radius, Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
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

export default function CirclePlazaScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const signupUnread = useTabBadgeStore((state) => state.signupUnread);

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

  const handleDiscoverCircles = useCallback(() => {
    router.push('/(tabs)/discover/circles');
  }, [router]);

  const handleFilter = useCallback(() => {
    router.push('/(tabs)/discover/filter');
  }, [router]);

  const handleCreatePost = useCallback(() => {
    router.push('/(tabs)/discover/create-post');
  }, [router]);

  const handleOpenNotifications = useCallback(() => {
    router.push({
      pathname: '/(tabs)/discover/notification-center',
      params: { initialTab: 'circle' },
    });
  }, [router]);

  return (
    <View style={d.container}>
      <NavHeader
        title={t('discover.plaza')}
        fallbackHref="/(tabs)/discover"
        rightSlot={
          <View style={s.headerActions}>
            <Pressable
              onPress={handleDiscoverCircles}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('discover.discoverCircles')}
            >
              <Ionicons
                name="search-outline"
                size={22}
                color={colors.textSecondary}
              />
            </Pressable>
            <Pressable
              onPress={handleFilter}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('discover.filter.title')}
            >
              <Ionicons
                name="options-outline"
                size={22}
                color={colors.textSecondary}
              />
            </Pressable>
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
                <Badge count={signupUnread} />
              </View>
            </Pressable>
          </View>
        }
      />
      <View style={s.content}>
        <PlazaFeed />
      </View>
      <Pressable
        style={[s.fab, d.fab]}
        onPress={handleCreatePost}
        accessibilityRole="button"
        accessibilityLabel={t('plaza.create.title')}
      >
        <Ionicons name="add" size={24} color={colors.white} />
      </Pressable>
    </View>
  );
}
