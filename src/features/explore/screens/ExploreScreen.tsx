import { useCallback, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExploreTile } from '@/features/explore/components/explore-tile';
import {
  AssistantTileArt,
  MomentsTileArt,
  RankingTileArt,
} from '@/features/explore/components/explore-tile-art';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { Gradients, Spacing, Typography, useTheme } from '@/theme';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { useNavigationLock } from '@/hooks/use-navigation-lock';
import { fetchAssistantBootstrap } from '@/services/api/assistant';
import { getAssistantChatHref, opensAssistantChatDirectly } from '@/features/assistant/assistant-entry';
import { useChatStore } from '@/chat-core/store';
import { reportHandledFailure } from '@/observability/report-failure';
import { useAuthStore } from '@/stores/authStore';
import type { AssistantBootstrapResponse } from '@/features/assistant/types';

// 卡片标题用站酷快乐体（OFL，见 assets/legal/asset-notices.json）。打包的是裁过的子集：只含
// 中英文标题用到的字和基本拉丁字母；日文、韩文、带重音的西语字母不在里面，那几种语言仍用系统粗体，
// 免得一个标题里混两种字体。改标题文案要重新裁字体（fontTools pyftsubset）。
const TILE_TITLE_FONT = 'ZCOOLKuaiLe-Subset';
const TILE_TITLE_FONT_LANGUAGES = ['zh', 'en'];

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

/** 探索 tab 首页：三块整行入口磁贴，依次是朋友圈、AI小助手、大众点评，只写名字。 */
export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const [titleFontLoaded] = useFonts({
    [TILE_TITLE_FONT]: require('../../../../assets/fonts/ZCOOLKuaiLe-Subset.ttf'),
  });
  const titleFontFamily =
    titleFontLoaded && TILE_TITLE_FONT_LANGUAGES.includes(i18n.language?.slice(0, 2))
      ? TILE_TITLE_FONT
      : undefined;
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

  // 小助手要先问清楚去哪(已有订阅直接进聊天,否则走订阅引导)再跳一次。以前总是先推
  // 引导页、加载完再 replace 成聊天页,看到两次进入动画。这个问题的答案在页面一露面就
  // 去后台问好,点的时候直接跳;点了才问的话每次都要干等一个请求(约 1 秒)。
  // 按会话代际记:换账号后不会拿上一个账号的答案。
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const assistantBootstrapRef = useRef<{
    epoch: number;
    request: Promise<AssistantBootstrapResponse>;
    result?: AssistantBootstrapResponse;
  } | null>(null);
  useFocusEffect(
    useCallback(() => {
      const previous = assistantBootstrapRef.current;
      const entry = {
        epoch: sessionEpoch,
        request: fetchAssistantBootstrap(),
        // 刷新期间先用同一会话上次的答案,点了照样马上跳。
        result: previous?.epoch === sessionEpoch ? previous.result : undefined,
      };
      entry.request.then(
        (result) => {
          entry.result = result;
        },
        // 预取失败不打扰:点的时候会再等这个请求、失败了落到引导页。
        () => undefined,
      );
      assistantBootstrapRef.current = entry;
    }, [sessionEpoch]),
  );

  // 偶尔还要等那个请求(刚进页面就点),所以用回到本页才解锁的锁防连点。
  const assistantLock = useNavigationLock();
  const handleOpenAssistant = useCallback(async () => {
    if (!assistantLock.tryLock()) return;
    const cached =
      assistantBootstrapRef.current?.epoch === sessionEpoch ? assistantBootstrapRef.current : null;
    try {
      const bootstrap = cached?.result ?? (await (cached?.request ?? fetchAssistantBootstrap()));
      if (opensAssistantChatDirectly(bootstrap)) {
        useChatStore.getState().mergeConversationSnapshot(bootstrap.conversation);
        router.push(getAssistantChatHref('explore', bootstrap));
        return;
      }
    } catch (error) {
      // 拉不到就交给引导页：它会自己重试并显示错误。
      reportHandledFailure('assistant', 'exploreBootstrap', error);
    }
    router.push('/(tabs)/explore/assistant');
  }, [assistantLock, router, sessionEpoch]);

  const handleOpenRanking = useCallback(() => {
    router.push('/(tabs)/explore/note-ranking');
  }, [router]);

  const momentsTitle = t('discover.moments');
  const assistantTitle = t('assistant.name');
  const rankingTitle = t('explore.ranking.title', { defaultValue: '大众点评' });

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
            titleFontFamily={titleFontFamily}
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
            titleFontFamily={titleFontFamily}
            art={<AssistantTileArt />}
            accessibilityLabel={assistantTitle}
            onPress={handleOpenAssistant}
          />
          <ExploreTile
            testID={E2E_TEST_IDS.exploreRankingEntry}
            title={rankingTitle}
            gradient={Gradients.exploreRanking}
            titleFontFamily={titleFontFamily}
            art={<RankingTileArt gradient={Gradients.exploreRanking} />}
            accessibilityLabel={rankingTitle}
            onPress={handleOpenRanking}
          />
        </View>
      </ScrollView>
    </View>
  );
}
