import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { MessageItem } from '@openim/rn-client-sdk';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryDateTitle,
  formatChatHistoryTime,
  getChatHistoryMessageTitle,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchConversationMessagesByDate } from '@/im/client';
import {
  getChatDetailHref,
  getChatHistoryDateHref,
} from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const PAGE_SIZE = 50;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  listContent: {
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});

export default function ChatHistoryDateResultsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
    date?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);
  const date = typeof params.date === 'string' ? params.date : '';

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [results, setResults] = useState<MessageItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const pageRef = useRef(1);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: {
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

  const search = useCallback(
    async (nextPage = 1) => {
      if (!conversationID || !date || (nextPage > 1 && loadingMore)) {
        if (nextPage === 1) setLoading(false);
        return;
      }

      if (nextPage === 1) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const page = await searchConversationMessagesByDate({
          conversationID,
          date,
          pageIndex: nextPage,
          count: PAGE_SIZE,
        });

        if (mountedRef.current) {
          pageRef.current = nextPage;
          setResults((prev) => (nextPage === 1 ? page : [...prev, ...page]));
          setHasMore(page.length === PAGE_SIZE);
        }
      } catch (err) {
        if (mountedRef.current) {
          if (nextPage === 1) {
            setResults([]);
            setError(t('chat.history.loadFailed'));
          }
          setHasMore(false);
        }
        if (isDev) {
          console.warn('[chat-history-date-results] search failed', err);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [conversationID, date, loadingMore, t],
  );

  useEffect(() => {
    void search(1);
    // 仅在会话 / 日期变化时重新拉取；search 的其它依赖不该触发重查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationID, date]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) {
      return;
    }
    void search(pageRef.current + 1);
  }, [hasMore, loading, loadingMore, search]);

  const openMessage = useCallback(
    (clientMsgID: string) => {
      if (!sourceID) {
        router.back();
        return;
      }
      router.push(
        getChatDetailHref('messages', sourceID, title, undefined, conversationID, clientMsgID),
      );
    },
    [conversationID, sourceID, title],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={formatChatHistoryDateTitle(date)}
        fallbackHref={getChatHistoryDateHref(conversationID, sourceID, title)}
      />
      <View style={s.content}>
        <FlatList
          data={results}
          keyExtractor={(item) => item.clientMsgID}
          contentContainerStyle={s.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => (
            <Pressable style={[s.card, d.card]} onPress={() => openMessage(item.clientMsgID)}>
              <Text style={d.title}>{getChatHistoryMessageTitle(item)}</Text>
              <Text style={d.meta}>{formatChatHistoryTime(item.sendTime)}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            error ? (
              <View>
                <Text style={[s.centeredText, d.errorText]}>{error}</Text>
                <Pressable style={d.retryButton} onPress={() => void search(1)}>
                  <Text style={d.retryText}>{t('chat.history.retry')}</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={[s.centeredText, d.centeredText]}>
                {loading
                  ? t('chat.history.searching')
                  : t('chat.history.noRecordsForDate')}
              </Text>
            )
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
