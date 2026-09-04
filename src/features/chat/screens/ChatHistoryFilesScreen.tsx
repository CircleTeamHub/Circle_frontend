import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryTimeIso,
  getChatMessageDtoTitle,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchChatMessages } from '@/chat-core/api';
import { getApiErrorMessage } from '@/services/api/errors';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

const PAGE_SIZE = 20;

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  listContent: {
    paddingBottom: Spacing.xl,
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

export default function ChatHistoryFilesScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);
  const [results, setResults] = useState<ChatMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!conversationID) {
      setResults([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    cursorRef.current = null;
    setLoading(true);
    setError(null);
    searchChatMessages(conversationID, { types: ['file'], limit: PAGE_SIZE })
      .then((page) => {
        if (!cancelled) {
          cursorRef.current = page.nextBeforeHeight;
          setResults([...page.messages].reverse());
          setHasMore(page.nextBeforeHeight !== null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(
            getApiErrorMessage(
              e,
              t('chat.history.loadFailed', { defaultValue: '加载失败' }),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationID, t]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !conversationID) {
      return;
    }

    setLoadingMore(true);

    try {
      const page = await searchChatMessages(conversationID, {
        types: ['file'],
        limit: PAGE_SIZE,
        ...(cursorRef.current !== null
          ? { beforeHeight: cursorRef.current }
          : {}),
      });
      cursorRef.current = page.nextBeforeHeight;
      setResults((prev) => [...prev, ...[...page.messages].reverse()]);
      setHasMore(page.nextBeforeHeight !== null);
    } catch (err) {
      // 翻页失败时停止继续翻；初始加载已有 error state 路径，这里不重置以保留已加载部分。
      setHasMore(false);
      reportHandledFailure('chatHistory', 'filesLoadMore', err);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationID, hasMore, loadingMore]);

  const handleRetry = useCallback(() => {
    if (!conversationID) {
      return;
    }

    cursorRef.current = null;
    setLoading(true);
    setError(null);
    searchChatMessages(conversationID, { types: ['file'], limit: PAGE_SIZE })
      .then((page) => {
        cursorRef.current = page.nextBeforeHeight;
        setResults([...page.messages].reverse());
        setHasMore(page.nextBeforeHeight !== null);
      })
      .catch((e: unknown) => {
        setError(
          getApiErrorMessage(
            e,
            t('chat.history.loadFailed', { defaultValue: '加载失败' }),
          ),
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [conversationID, t]);

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
        title={t('chat.history.files', { defaultValue: '文件' })}
        fallbackHref={getChatDetailHref('messages', sourceID, title, undefined, conversationID)}
      />
      <View style={s.content}>
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
          onEndReached={() => void handleLoadMore()}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => (
            <Pressable style={[s.card, d.card]} onPress={() => openMessage(item.id)}>
              <Text style={d.title}>{getChatMessageDtoTitle(item)}</Text>
              <Text style={d.meta}>
                {Number(item.content['size'] ?? 0).toLocaleString('zh-CN')} B ·{' '}
                {formatChatHistoryTimeIso(item.createdAt)}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            loading ? null : error ? (
              <View>
                <Text style={[s.centeredText, d.errorText]}>{error}</Text>
                <Pressable style={d.retryButton} onPress={handleRetry}>
                  <Text style={d.retryText}>
                    {t('common.retry', { defaultValue: '重试' })}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Text style={[s.centeredText, d.centeredText]}>
                {t('chat.history.noFiles', { defaultValue: '暂无文件记录' })}
              </Text>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <Text style={[s.centeredText, d.centeredText]}>
                {t('common.loading', { defaultValue: '加载中…' })}
              </Text>
            ) : null
          }
        />
      </View>
    </View>
  );
}
