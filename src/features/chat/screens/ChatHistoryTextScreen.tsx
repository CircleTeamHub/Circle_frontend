import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { MessageItem } from '@openim/rn-client-sdk';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryTime,
  getChatHistoryMessageTitle,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchConversationTextMessages } from '@/im/client';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const PAGE_SIZE = 20;

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
  },
  actionButton: {
    minWidth: 76,
    height: 44,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  listContent: {
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  resultCard: {
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});

export default function ChatHistoryTextScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
    keyword?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);
  const initialKeyword = typeof params.keyword === 'string' ? params.keyword : '';
  const [keyword, setKeyword] = useState(initialKeyword);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [results, setResults] = useState<MessageItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(1);
  const activeKeywordRef = useRef('');

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      input: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.surface,
        color: colors.text,
        ...Typography.bodyRegular,
      },
      actionButton: { backgroundColor: colors.primary },
      actionText: { color: colors.white, ...Typography.body },
      resultCard: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      title: { color: colors.text, ...Typography.body },
      meta: { color: colors.textSecondary, ...Typography.small },
      centeredText: { color: colors.textSecondary, ...Typography.bodyRegular },
      errorText: { color: colors.error, ...Typography.bodyRegular },
      retryButton: {
        marginTop: Spacing.md,
        alignSelf: 'center' as const,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.lg,
        backgroundColor: colors.primary,
      },
      retryText: { color: colors.white, ...Typography.body },
    }),
    [colors],
  );

  const handleSearch = useCallback(async (overrideKeyword?: string) => {
    if (loading) {
      return;
    }

    const nextKeyword = (overrideKeyword ?? keyword).trim();
    setSearched(true);

    if (!conversationID || !nextKeyword) {
      setResults([]);
      setHasMore(false);
      return;
    }

    activeKeywordRef.current = nextKeyword;
    pageRef.current = 1;
    setLoading(true);
    setError(null);

    try {
      const page = await searchConversationTextMessages({
        conversationID,
        keyword: nextKeyword,
        pageIndex: 1,
        count: PAGE_SIZE,
      });
      setResults(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setResults([]);
      setHasMore(false);
      setError(t('chat.history.loadFailed'));
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[chat-history-text] search failed', err);
      }
    } finally {
      setLoading(false);
    }
  }, [conversationID, keyword, loading, t]);

  useEffect(() => {
    if (initialKeyword) {
      void handleSearch(initialKeyword);
    }
    // 初始关键词只用于首屏自动搜索，后续输入由用户触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !conversationID) {
      return;
    }

    const nextPage = pageRef.current + 1;
    setLoadingMore(true);

    try {
      const page = await searchConversationTextMessages({
        conversationID,
        keyword: activeKeywordRef.current,
        pageIndex: nextPage,
        count: PAGE_SIZE,
      });
      pageRef.current = nextPage;
      setResults((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      // 翻页失败：停止继续翻，留住已加载部分。
      setHasMore(false);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[chat-history-text] load-more failed', err);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [conversationID, hasMore, loadingMore]);

  const openMessage = useCallback((clientMsgID: string) => {
    if (!sourceID) {
      router.back();
      return;
    }

    router.push(getChatDetailHref('messages', sourceID, title, undefined, conversationID, clientMsgID));
  }, [conversationID, sourceID, title]);

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('chat.history.textTitle')}
        fallbackHref={getChatDetailHref('messages', sourceID, title, undefined, conversationID)}
      />
      <View style={s.content}>
        <View style={s.searchRow}>
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder={t('chat.history.keywordPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            style={[s.input, d.input]}
            returnKeyType="search"
            onSubmitEditing={() => void handleSearch()}
          />
          <Pressable
            style={[s.actionButton, d.actionButton]}
            onPress={() => void handleSearch()}
            disabled={loading}
          >
            <Text style={d.actionText}>
              {loading ? t('chat.history.searching') : t('chat.history.search')}
            </Text>
          </Pressable>
        </View>

        <FlatList
          data={results}
          keyExtractor={(item) => item.clientMsgID}
          contentContainerStyle={s.listContent}
        {...keyboardDismissOnDragProps}
          onEndReached={() => void handleLoadMore()}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => (
            <Pressable style={[s.resultCard, d.resultCard]} onPress={() => openMessage(item.clientMsgID)}>
              <Text style={d.title}>{getChatHistoryMessageTitle(item)}</Text>
              <Text style={d.meta}>
                {item.senderNickname || item.sendID} · {formatChatHistoryTime(item.sendTime)}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            error ? (
              <View>
                <Text style={[s.centeredText, d.errorText]}>{error}</Text>
                <Pressable style={d.retryButton} onPress={() => void handleSearch()}>
                  <Text style={d.retryText}>{t('chat.history.retry')}</Text>
                </Pressable>
              </View>
            ) : searched ? (
              <Text style={[s.centeredText, d.centeredText]}>
                {t('chat.history.noMatches')}
              </Text>
            ) : null
          }
          ListFooterComponent={
            loadingMore ? (
              <Text style={[s.centeredText, d.centeredText]}>
                {t('chat.history.loading')}
              </Text>
            ) : null
          }
        />
      </View>
    </View>
  );
}
