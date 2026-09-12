import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/ui/badge';
import { PlazaFeed } from '@/features/discover/components/plaza-feed';
import { CircleNotificationSettingsSheet } from '@/features/discover/components/circle-notification-settings-sheet';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

const s = StyleSheet.create({
  // tab 根屏的头部：大标题 + 右侧动作，没有返回箭头（对齐 ContactsScreen）。
  // 这里不能用 NavHeader —— 它无条件渲染 chevron-back，根屏上会留一个
  // 按了没反应的返回键。
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
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
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
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
  // 圈子铃铛 = 圈子通知（担保验证/入圈审批/圈子帖动态）+ 报名管理，两者相加。
  // 朋友圈的互动不进这里。
  const circleUnread = useTabBadgeStore((state) => state.circleUnread);
  const signupUnread = useTabBadgeStore((state) => state.signupUnread);
  const circleBellUnread = circleUnread + signupUnread;
  const [notificationSettingsVisible, setNotificationSettingsVisible] =
    useState(false);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: colors.background,
      },
      title: {
        color: colors.text,
        ...Typography.title,
      },
      fab: {
        backgroundColor: colors.primary,
      },
    }),
    [colors, insets.top],
  );

  const handleFilter = useCallback(() => {
    router.push('/(tabs)/discover/filter');
  }, [router]);

  const handleCreatePost = useCallback(() => {
    router.push('/(tabs)/discover/create-post');
  }, [router]);

  const openNotificationSettings = useCallback(
    () => setNotificationSettingsVisible(true),
    [],
  );
  const closeNotificationSettings = useCallback(
    () => setNotificationSettingsVisible(false),
    [],
  );

  const handleOpenNotifications = useCallback(() => {
    router.push({
      pathname: '/(tabs)/discover/notification-center',
      params: { domain: 'circle' },
    });
  }, [router]);

  const handleOpenCircleManagement = useCallback(() => {
    router.push('/(tabs)/discover/management');
  }, [router]);

  return (
    <View testID={E2E_TEST_IDS.circlePlazaScreen} style={d.container}>
      <View style={[s.header, { paddingTop: Spacing.md }]}>
        <Text style={d.title} accessibilityRole="header">
          {t('discover.circleTitle')}
        </Text>
        <View style={s.headerActions}>
          <Pressable
            onPress={handleOpenCircleManagement}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('discover.management')}
          >
            <Ionicons
              name="planet-outline"
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
              <Badge count={circleBellUnread} />
            </View>
          </Pressable>
          {/* 通知设置。图标刻意不用 options-outline —— 左边的筛选已经占了它，
              右上角两个一样的图标分不出谁是谁。 */}
          <Pressable
            onPress={openNotificationSettings}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('discover.notifications.title')}
          >
            <Ionicons
              name="settings-outline"
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>
      </View>
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
      <CircleNotificationSettingsSheet
        visible={notificationSettingsVisible}
        onClose={closeNotificationSettings}
      />
    </View>
  );
}
