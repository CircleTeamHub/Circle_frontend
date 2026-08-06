import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryDateTitle,
  formatChatHistoryTimeIso,
  getChatMessageDtoTitle,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchChatMessages } from '@/chat-core/api';
import type { ChatMessageDto } from '@/chat-core/protocol';
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
  const [results, setResults] = useState<ChatMessageDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // height 键集游标:null = 没有更早的了。
  const cursorRef = useRef<number | null>(null);

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
    async (reset: boolean) => {
      if (!conversationID || !date || (!reset && loadingMore)) {
        if (reset) setLoading(false);
        return;
      }

      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const page = await searchChatMessages(conversationID, {
          date,
          limit: PAGE_SIZE,
          ...(reset || cursorRef.current === null
            ? {}
            : { beforeHeight: cursorRef.current }),
        });

        if (mountedRef.current) {
          cursorRef.current = page.nextBeforeHeight;
          // 页内升序 → 反转为最新在前(与旧检索展示一致);翻页追加更早的。
          const descending = [...page.messages].reverse();
          setResults((prev) => (reset ? descending : [...prev, ...descending]));
          setHasMore(page.nextBeforeHeight !== null);
        }
      } catch (err) {
        if (mountedRef.current) {
          if (reset) {
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
    cursorRef.current = null;
    void search(true);
    // 仅在会话 / 日期变化时重新拉取；search 的其它依赖不该触发重查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationID, date]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) {
      return;
    }
    void search(false);
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
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => (
            <Pressable style={[s.card, d.card]} onPress={() => openMessage(item.id)}>
              <Text style={d.title}>{getChatMessageDtoTitle(item)}</Text>
              <Text style={d.meta}>{formatChatHistoryTimeIso(item.createdAt)}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            error ? (
              <View>
                <Text style={[s.centeredText, d.errorText]}>{error}</Text>
                <Pressable style={d.retryButton} onPress={() => void search(true)}>
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
