import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
  type SectionListData,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryMonth,
  getChatMediaThumbnailUris,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchChatMessages } from '@/chat-core/api';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

const PAGE_SIZE = 30;
const MEDIA_GRID_COLUMNS = 3;

/**
 * 首屏/重试/翻页共用一份类型过滤,免得三处再各自漂移。
 *
 * 图片和视频共用媒体历史页。类型必须与后端 CLIENT_MESSAGE_TYPES 同步，
 * 否则 HistoryQueryDto 会把整个请求判为 400。
 */
const MEDIA_HISTORY_TYPES = ['image', 'video'];

type MediaRow = ChatMessageDto[];
type MediaMonthSection = {
  title: string;
  data: MediaRow[];
};

function chunkMediaRows(items: ChatMessageDto[]) {
  const rows: MediaRow[] = [];
  for (let index = 0; index < items.length; index += MEDIA_GRID_COLUMNS) {
    rows.push(items.slice(index, index + MEDIA_GRID_COLUMNS));
  }
  return rows;
}

function groupMediaMessagesByMonth(messages: ChatMessageDto[]): MediaMonthSection[] {
  const groups = new Map<string, ChatMessageDto[]>();

  for (const message of messages) {
    const title =
      formatChatHistoryMonth(Date.parse(message.createdAt)) || i18n.t('chat.history.unknownMonth');
    const current = groups.get(title) ?? [];
    current.push(message);
    groups.set(title, current);
  }

  return Array.from(groups.entries()).map(([title, items]) => ({
    title,
    data: chunkMediaRows(items),
  }));
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  listContent: {
    paddingBottom: Spacing.xl,
  },
  sectionHeader: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  mediaGrid: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  mediaTile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  mediaTileSpacer: {
    flex: 1,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredText: {
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});

type MediaTileProps = {
  colors: ReturnType<typeof useTheme>['colors'];
  fallbackTextStyle: object;
  item: ChatMessageDto;
  onOpen: (clientMsgID: string) => void;
  tileStyle: object;
  videoBadgeStyle: object;
};

function MediaTile({
  colors,
  fallbackTextStyle,
  item,
  onOpen,
  tileStyle,
  videoBadgeStyle,
}: MediaTileProps) {
  const { t } = useTranslation();
  const thumbnailUris = useMemo(() => getChatMediaThumbnailUris(item), [item]);
  const [failedCount, setFailedCount] = useState(0);
  const thumbnailUri = thumbnailUris[failedCount] ?? null;
  const isVideo = item.type === 'video';

  const handleImageError = useCallback(() => {
    setFailedCount((current) => current + 1);
  }, []);

  useEffect(() => {
    setFailedCount(0);
  }, [item.id]);

  return (
    <Pressable
      key={item.id}
      style={[s.mediaTile, tileStyle]}
      onPress={() => onOpen(item.id)}
    >
      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
          style={s.thumbnail}
          contentFit="cover"
          onError={handleImageError}
        />
      ) : (
        <View style={s.fallback}>
          <Text style={fallbackTextStyle}>
            {isVideo ? t('chat.history.video') : t('chat.history.image')}
          </Text>
        </View>
      )}
      {isVideo ? (
        <View style={[s.videoBadge, videoBadgeStyle]}>
          <Ionicons name="play-circle" size={20} color={colors.white} />
        </View>
      ) : null}
    </Pressable>
  );
}

export default function ChatHistoryMediaScreen() {
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

  // Guards async setState on the retry path (the initial-load effect has its
  // own per-run `cancelled` flag).
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const loadFirstPage = useCallback(() => {
    if (!conversationID) {
      setResults([]);
      setLoading(false);
      return;
    }

    cursorRef.current = null;
    setLoading(true);
    setError(null);
    searchChatMessages(conversationID, { types: MEDIA_HISTORY_TYPES, limit: PAGE_SIZE })
      .then((page) => {
        if (!mountedRef.current) return;
        cursorRef.current = page.nextBeforeHeight;
        setResults([...page.messages].reverse());
        setHasMore(page.nextBeforeHeight !== null);
      })
      .catch((e: unknown) => {
        reportHandledFailure('chatHistory', 'mediaLoad', e);
        if (!mountedRef.current) return;
        setError(t('chat.history.loadFailed'));
        setResults([]);
        setHasMore(false);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [conversationID, t]);

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
    searchChatMessages(conversationID, { types: MEDIA_HISTORY_TYPES, limit: PAGE_SIZE })
      .then((page) => {
        if (!cancelled) {
          cursorRef.current = page.nextBeforeHeight;
          setResults([...page.messages].reverse());
          setHasMore(page.nextBeforeHeight !== null);
        }
      })
      .catch((e: unknown) => {
        reportHandledFailure('chatHistory', 'mediaLoad', e);
        if (!cancelled) {
          setError(t('chat.history.loadFailed'));
          setResults([]);
          setHasMore(false);
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
        types: MEDIA_HISTORY_TYPES,
        limit: PAGE_SIZE,
        ...(cursorRef.current !== null
          ? { beforeHeight: cursorRef.current }
          : {}),
      });
      cursorRef.current = page.nextBeforeHeight;
      setResults((prev) => [...prev, ...[...page.messages].reverse()]);
      setHasMore(page.nextBeforeHeight !== null);
    } catch (err) {
      setHasMore(false);
      reportHandledFailure('chatHistory', 'mediaLoadMore', err);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationID, hasMore, loadingMore]);

  const sections = useMemo(
    () => groupMediaMessagesByMonth(results),
    [results],
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      sectionTitle: { color: colors.text, ...Typography.body },
      tile: {
        backgroundColor: colors.surfaceBorder,
      },
      fallbackText: { color: colors.textSecondary, ...Typography.small },
      videoBadge: { backgroundColor: colors.overlay },
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

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<MediaRow, MediaMonthSection> }) => (
      <View style={s.sectionHeader}>
        <Text style={d.sectionTitle}>{section.title}</Text>
      </View>
    ),
    [d.sectionTitle],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('chat.history.mediaTitle')}
        fallbackHref={getChatDetailHref('messages', sourceID, title, undefined, conversationID)}
      />
      <View style={s.content}>
        <SectionList
          sections={sections}
          keyExtractor={(item, index) => `${item[0]?.id ?? 'row'}-${index}`}
          contentContainerStyle={s.listContent}
          onEndReached={() => void handleLoadMore()}
          onEndReachedThreshold={0.3}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={renderSectionHeader}
          renderItem={({ item }) => (
            <View style={s.mediaGrid}>
              {item.map((mediaItem) => (
                <MediaTile
                  key={mediaItem.id}
                  colors={colors}
                  fallbackTextStyle={d.fallbackText}
                  item={mediaItem}
                  onOpen={openMessage}
                  tileStyle={d.tile}
                  videoBadgeStyle={d.videoBadge}
                />
              ))}
              {Array.from({ length: MEDIA_GRID_COLUMNS - item.length }).map((_, index) => (
                <View key={`spacer-${index}`} style={s.mediaTileSpacer} />
              ))}
            </View>
          )}
          ListEmptyComponent={
            loading ? null : error ? (
              <View>
                <Text style={[s.centeredText, d.errorText]}>{error}</Text>
                <Pressable style={d.retryButton} onPress={loadFirstPage}>
                  <Text style={d.retryText}>{t('chat.history.retry')}</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={[s.centeredText, d.centeredText]}>
                {t('chat.history.noMedia')}
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
