import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/ui/badge';
import { FloatingActionButton } from '@/components/ui/floating-action-button';
import { NavHeader } from '@/components/ui/nav-header';
import { MomentsFeed } from '@/features/discover/components/moments-feed';
import { getUserProfileScopeFromSegments } from '@/features/user/utils/routes';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { Spacing, useTheme } from '@/theme';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

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
});

export default function MomentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  // 朋友圈铃铛只算朋友圈的未读（动态点赞/评论/回复/@ + 资料点赞）。圈子的通知
  // 归广场页那个铃铛(domain=circle)，两边不互相报红点。
  const momentsUnread = useTabBadgeStore((state) => state.momentsUnread);
  // 朋友圈的家在探索 tab；圈子 / 联系人栈里的旧路由仍走圈子栈那套子页。
  const inExplore = getUserProfileScopeFromSegments(useSegments()) === 'explore';

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: colors.background,
      },
      // 发朋友圈按钮与笔记页同款（FloatingActionButton），贴着安全区底部。
      fab: {
        bottom: insets.bottom + Spacing.lg,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  const handleCreateMoment = useCallback(() => {
    router.push(
      inExplore ? '/(tabs)/explore/create-moment' : '/(tabs)/discover/create-moment',
    );
  }, [inExplore, router]);

  const handleOpenNotifications = useCallback(() => {
    router.push({
      pathname: inExplore
        ? '/(tabs)/explore/notification-center'
        : '/(tabs)/discover/notification-center',
      params: { domain: 'moments' },
    });
  }, [inExplore, router]);

  return (
    <View testID={E2E_TEST_IDS.momentsScreen} style={d.container}>
      <NavHeader
        title={t('discover.moments')}
        fallbackHref={inExplore ? '/(tabs)/explore' : '/(tabs)/discover'}
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
      <FloatingActionButton
        testID={E2E_TEST_IDS.momentsCreate}
        style={d.fab}
        onPress={handleCreateMoment}
        label={t('moment.createTitle')}
      />
    </View>
  );
}
