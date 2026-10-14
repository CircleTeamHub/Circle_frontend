import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/ui/badge';
import { PlazaFeed } from '@/features/discover/components/plaza-feed';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

// 发帖入口用 App 图标里的纸飞机，垫一个跟随主题的圆底。
const PLANE_LOGO = require('../../../../assets/images/login-logo-plane.png');
// 深色模式用提亮版（同色相、亮度上调），原图的深紫笔画在深灰圆底上发闷。
const PLANE_LOGO_DARK = require('../../../../assets/images/plane-fab-dark.png');

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
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: {
    transform: [{ scale: 0.94 }],
  },
  fabPlane: {
    width: 34,
    height: 34,
  },
});

export default function CirclePlazaScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, resolvedMode } = useTheme();
  const { t } = useTranslation();
  // 圈子铃铛 = 圈子通知（担保验证/入圈审批/圈子帖动态）+ 报名管理，两者相加。
  // 朋友圈的互动不进这里。
  const circleUnread = useTabBadgeStore((state) => state.circleUnread);
  const signupUnread = useTabBadgeStore((state) => state.signupUnread);
  const circleBellUnread = circleUnread + signupUnread;

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
      // 跟随主题：浅色白底、深色 #1C1C1E 卡片底。
      fab: {
        backgroundColor: colors.surface,
        borderColor: withAlpha(colors.primary, 0.24),
        shadowColor: colors.primary,
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
        </View>
      </View>
      <View style={s.content}>
        <PlazaFeed />
      </View>
      <Pressable
        style={({ pressed }) => [s.fab, d.fab, pressed ? s.fabPressed : null]}
        onPress={handleCreatePost}
        accessibilityRole="button"
        accessibilityLabel={t('plaza.create.title')}
      >
        <Image
          source={resolvedMode === 'dark' ? PLANE_LOGO_DARK : PLANE_LOGO}
          style={s.fabPlane}
          contentFit="contain"
        />
      </Pressable>
    </View>
  );
}
