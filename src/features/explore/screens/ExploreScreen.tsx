import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExploreTile } from '@/features/explore/components/explore-tile';
import {
  AssistantTileArt,
  MomentsTileArt,
} from '@/features/explore/components/explore-tile-art';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { Gradients, Spacing, Typography, useTheme } from '@/theme';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

const s = StyleSheet.create({
  // tab 根屏头部：大标题，没有返回箭头（对齐圈子广场 / 联系人）。
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    // 浮动 tab bar 盖在内容上，底部留出它的高度。
    paddingBottom: 110,
  },
  tiles: {
    gap: Spacing.md,
  },
});

/** 探索 tab 首页：两块整行入口磁贴，朋友圈在上、AI小助手在下，只写名字。 */
export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  // 朋友圈磁贴的红点 = 朋友圈铃铛的未读（与探索 tab 的红点同一口径）。
  const momentsUnread = useTabBadgeStore((state) => state.momentsUnread);

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
    }),
    [colors, insets.top],
  );

  const handleOpenMoments = useCallback(() => {
    router.push('/(tabs)/explore/moments');
  }, [router]);

  const handleOpenAssistant = useCallback(() => {
    router.push('/(tabs)/explore/assistant');
  }, [router]);

  const momentsTitle = t('discover.moments');
  const assistantTitle = t('assistant.name');

  return (
    <View testID={E2E_TEST_IDS.exploreScreen} style={d.container}>
      <View style={s.header}>
        <Text style={d.title} accessibilityRole="header">
          {t('explore.title')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.tiles}>
          <ExploreTile
            testID={E2E_TEST_IDS.exploreMomentsEntry}
            title={momentsTitle}
            gradient={Gradients.exploreMoments}
            art={<MomentsTileArt gradient={Gradients.exploreMoments} />}
            badgeCount={momentsUnread}
            accessibilityLabel={
              momentsUnread > 0
                ? `${momentsTitle} ${t('tabs.unreadCount', { count: momentsUnread })}`
                : momentsTitle
            }
            onPress={handleOpenMoments}
          />
          <ExploreTile
            testID={E2E_TEST_IDS.exploreAssistantEntry}
            title={assistantTitle}
            gradient={Gradients.exploreAssistant}
            art={<AssistantTileArt />}
            accessibilityLabel={assistantTitle}
            onPress={handleOpenAssistant}
          />
        </View>
      </ScrollView>
    </View>
  );
}
