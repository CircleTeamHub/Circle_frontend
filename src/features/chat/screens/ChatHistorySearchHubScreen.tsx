import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import { resolveChatHistoryRouteParams } from '@/features/chat/chat-history';
import {
  getChatDetailHref,
  getChatHistoryDateHref,
  getChatHistoryFilesHref,
  getChatHistoryMediaHref,
  getChatHistoryTextHref,
} from '@/features/user/utils/routes';
import { Radius, Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  section: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
  },
});

export default function ChatHistorySearchHubScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      section: {
        backgroundColor: colors.surface,
      },
    }),
    [colors.background, colors.surface],
  );

  const openTextSearch = useCallback(() => {
    router.push(getChatHistoryTextHref(conversationID, sourceID, title));
  }, [conversationID, sourceID, title]);

  const openMediaSearch = useCallback(() => {
    router.push(getChatHistoryMediaHref(conversationID, sourceID, title));
  }, [conversationID, sourceID, title]);

  const openFileSearch = useCallback(() => {
    router.push(getChatHistoryFilesHref(conversationID, sourceID, title));
  }, [conversationID, sourceID, title]);

  const openDateSearch = useCallback(() => {
    router.push(getChatHistoryDateHref(conversationID, sourceID, title));
  }, [conversationID, sourceID, title]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title="查找聊天记录"
        fallbackHref={getChatDetailHref(sourceID, title, undefined, conversationID)}
      />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.section, d.section]}>
          <MenuRow
            icon="search-outline"
            label="搜索文字消息"
            onPress={openTextSearch}
          />
          <Divider />
          <MenuRow
            icon="images-outline"
            label="图片/视频"
            onPress={openMediaSearch}
          />
          <Divider />
          <MenuRow
            icon="document-outline"
            label="文件"
            onPress={openFileSearch}
          />
          <Divider />
          <MenuRow
            icon="calendar-outline"
            label="按日期"
            onPress={openDateSearch}
          />
        </View>
      </ScrollView>
    </View>
  );
}
