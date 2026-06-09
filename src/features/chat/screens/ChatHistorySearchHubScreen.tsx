import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
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
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  searchBox: {
    height: 44,
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  searchInput: {
    flex: 1,
    padding: 0,
  },
  section: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
  },
});

export default function ChatHistorySearchHubScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);
  const [keyword, setKeyword] = useState('');

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      section: {
        backgroundColor: colors.surface,
      },
      searchBox: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      searchInput: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
    }),
    [colors],
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

  const handleSubmitKeywordSearch = useCallback(() => {
    const nextKeyword = keyword.trim();
    router.push(
      getChatHistoryTextHref(conversationID, sourceID, title, nextKeyword),
    );
  }, [conversationID, keyword, sourceID, title]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('chat.history.findTitle')}
        fallbackHref={getChatDetailHref('messages', sourceID, title, undefined, conversationID)}
      />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.searchBox, d.searchBox]}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder={t('chat.history.searchPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            style={[s.searchInput, d.searchInput]}
            returnKeyType="search"
            onSubmitEditing={handleSubmitKeywordSearch}
          />
          <Pressable hitSlop={8} onPress={handleSubmitKeywordSearch}>
            <Ionicons name="arrow-forward-circle" size={20} color={colors.primary} />
          </Pressable>
        </View>

        <View style={[s.section, d.section]}>
          <MenuRow
            icon="search-outline"
            label={t('chat.history.textTitle')}
            onPress={openTextSearch}
          />
          <Divider />
          <MenuRow
            icon="images-outline"
            label={t('chat.history.mediaTitle')}
            onPress={openMediaSearch}
          />
          <Divider />
          <MenuRow
            icon="document-outline"
            label={t('chat.history.files')}
            onPress={openFileSearch}
          />
          <Divider />
          <MenuRow
            icon="calendar-outline"
            label={t('chat.history.dateTitle')}
            onPress={openDateSearch}
          />
        </View>
      </ScrollView>
    </View>
  );
}
