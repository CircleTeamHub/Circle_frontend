import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, Typography, useTheme } from '@/theme';
import { CircleNotificationToggles } from '@/features/discover/components/circle-notification-toggles';
import {
  getCircleGuideHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  pageTitle: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  divider: {
    height: 1,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  guideText: {
    flex: 1,
    gap: Spacing.xs,
  },
  guideTitle: {
    ...Typography.h3,
  },
  guideHint: {
    ...Typography.caption,
  },
});

export default function CircleNotificationSettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const segments = useSegments();

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      pageTitle: {
        color: colors.text,
        ...Typography.h1,
      },
      divider: { backgroundColor: colors.divider },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('discover.notifications.title')} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.pageTitle, d.pageTitle]}>
          {t('discover.notifications.title')}
        </Text>

        {/* 圈子玩法说明入口：讲清卡片颜色含义 + 活动怎么玩。只有整页设置带它，
            圈子动态头部的快捷弹层不放，那里要的是「两下改完就关」。 */}
        <Pressable
          style={s.guideRow}
          // 这一页现在也从联系人栈打开，写死 discover 路由会把用户甩去另一个
          // tab，返回时回不到他出发的那一栈。按当前栈解析。
          onPress={() =>
            router.push(getCircleGuideHref(getUserProfileScopeFromSegments(segments)))
          }
          accessibilityRole="button"
          accessibilityLabel={t('discover.guide.title')}
        >
          <Ionicons name="book-outline" size={22} color={colors.primary} />
          <View style={s.guideText}>
            <Text style={[s.guideTitle, { color: colors.text }]}>
              {t('discover.guide.title')}
            </Text>
            <Text style={[s.guideHint, { color: colors.textSecondary }]}>
              {t('discover.guide.entryHint')}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>

        <View style={[s.divider, d.divider]} />

        <CircleNotificationToggles />
      </ScrollView>
    </View>
  );
}
