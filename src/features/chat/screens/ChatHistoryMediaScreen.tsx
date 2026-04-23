import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageType, type MessageItem } from '@openim/rn-client-sdk';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryTime,
  isChatHistoryMediaMessage,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchConversationMediaMessages } from '@/im/client';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

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
    gap: Spacing.sm,
  },
  thumbnail: {
    width: '100%',
    height: 160,
    borderRadius: Radius.lg,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});

export default function ChatHistoryMediaScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);
  const [results, setResults] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(1);

  useEffect(() => {
    let cancelled = false;

    if (!conversationID) {
      setResults([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    pageRef.current = 1;
    setLoading(true);
    setError(null);
    searchConversationMediaMessages({ conversationID, pageIndex: 1, count: PAGE_SIZE })
      .then((messages) => {
        if (!cancelled) {
          setResults(messages.filter(isChatHistoryMediaMessage));
          setHasMore(messages.length === PAGE_SIZE);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载失败');
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
  }, [conversationID]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !conversationID) {
      return;
    }

    const nextPage = pageRef.current + 1;
    setLoadingMore(true);

    try {
      const page = await searchConversationMediaMessages({
        conversationID,
        pageIndex: nextPage,
        count: PAGE_SIZE,
      });
      pageRef.current = nextPage;
      setResults((prev) => [...prev, ...page.filter(isChatHistoryMediaMessage)]);
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationID, hasMore, loadingMore]);

  const handleRetry = useCallback(() => {
    if (!conversationID) {
      return;
    }

    pageRef.current = 1;
    setLoading(true);
    setError(null);
    searchConversationMediaMessages({ conversationID, pageIndex: 1, count: PAGE_SIZE })
      .then((messages) => {
        setResults(messages.filter(isChatHistoryMediaMessage));
        setHasMore(messages.length === PAGE_SIZE);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [conversationID]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      meta: { color: colors.textSecondary, ...Typography.small },
      centeredText: { color: colors.textSecondary, ...Typography.bodyRegular },
      fallback: {
        backgroundColor: colors.surfaceBorder,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
      },
      videoLabel: { color: colors.text, ...Typography.body },
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

    router.push(getChatDetailHref(sourceID, title, undefined, conversationID, clientMsgID));
  }, [conversationID, sourceID, title]);

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title="图片/视频"
        fallbackHref={getChatDetailHref(sourceID, title, undefined, conversationID)}
      />
      <View style={s.content}>
        <FlatList
          data={results}
          keyExtractor={(item) => item.clientMsgID}
          contentContainerStyle={s.listContent}
          onEndReached={() => void handleLoadMore()}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => {
            const thumbnailUri =
              item.contentType === MessageType.PictureMessage
                ? item.pictureElem?.snapshotPicture?.url ||
                  item.pictureElem?.sourcePicture?.url
                : item.videoElem?.snapshotUrl;

            return (
              <Pressable style={[s.card, d.card]} onPress={() => openMessage(item.clientMsgID)}>
                {thumbnailUri ? (
                  <Image source={{ uri: thumbnailUri }} style={s.thumbnail} contentFit="cover" />
                ) : (
                  <View style={[s.thumbnail, d.fallback]}>
                    <Text style={d.videoLabel}>
                      {item.contentType === MessageType.VideoMessage ? '视频' : '图片'}
                    </Text>
                  </View>
                )}
                <Text style={d.meta}>{formatChatHistoryTime(item.sendTime)}</Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            loading ? null : error ? (
              <View>
                <Text style={[s.centeredText, d.errorText]}>{error}</Text>
                <Pressable style={d.retryButton} onPress={handleRetry}>
                  <Text style={d.retryText}>重试</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={[s.centeredText, d.centeredText]}>
                暂无图片或视频记录
              </Text>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <Text style={[s.centeredText, d.centeredText]}>加载中…</Text>
            ) : null
          }
        />
      </View>
    </View>
  );
}
