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
import { MessageType, type MessageItem } from '@openim/rn-client-sdk';
import i18n from '@/i18n';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryMonth,
  isChatHistoryMediaMessage,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchConversationMediaMessages } from '@/im/client';
import { normalizeMediaUrl } from '@/services/api/utils';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const PAGE_SIZE = 30;
const MEDIA_GRID_COLUMNS = 3;

type MediaRow = MessageItem[];
type MediaMonthSection = {
  title: string;
  data: MediaRow[];
};

function chunkMediaRows(items: MessageItem[]) {
  const rows: MediaRow[] = [];
  for (let index = 0; index < items.length; index += MEDIA_GRID_COLUMNS) {
    rows.push(items.slice(index, index + MEDIA_GRID_COLUMNS));
  }
  return rows;
}

function groupMediaMessagesByMonth(messages: MessageItem[]): MediaMonthSection[] {
  const groups = new Map<string, MessageItem[]>();

  for (const message of messages) {
    const title =
      formatChatHistoryMonth(message.sendTime) || i18n.t('chat.history.unknownMonth');
    const current = groups.get(title) ?? [];
    current.push(message);
    groups.set(title, current);
  }

  return Array.from(groups.entries()).map(([title, items]) => ({
    title,
    data: chunkMediaRows(items),
  }));
}

function normalizeCandidateUrl(value: string | null | undefined) {
  return value ? normalizeMediaUrl(value) ?? value : null;
}

function getMediaThumbnailUris(item: MessageItem) {
  const candidates =
    item.contentType === MessageType.PictureMessage
      ? [
          item.pictureElem?.snapshotPicture?.url,
          item.pictureElem?.sourcePicture?.url,
          item.pictureElem?.bigPicture?.url,
        ]
      : [
          item.videoElem?.snapshotUrl,
          item.videoElem?.videoUrl,
        ];

  return Array.from(
    new Set(
      candidates
        .map(normalizeCandidateUrl)
        .filter((value): value is string => Boolean(value)),
    ),
  );
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
  item: MessageItem;
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
  const thumbnailUris = useMemo(() => getMediaThumbnailUris(item), [item]);
  const [failedCount, setFailedCount] = useState(0);
  const thumbnailUri = thumbnailUris[failedCount] ?? null;
  const isVideo = item.contentType === MessageType.VideoMessage;

  const handleImageError = useCallback(() => {
    setFailedCount((current) => current + 1);
  }, []);

  useEffect(() => {
    setFailedCount(0);
  }, [item.clientMsgID]);

  return (
    <Pressable
      key={item.clientMsgID}
      style={[s.mediaTile, tileStyle]}
      onPress={() => onOpen(item.clientMsgID)}
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
  const [results, setResults] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(1);

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

    pageRef.current = 1;
    setLoading(true);
    setError(null);
    searchConversationMediaMessages({ conversationID, pageIndex: 1, count: PAGE_SIZE })
      .then((messages) => {
        if (!mountedRef.current) return;
        setResults(messages.filter(isChatHistoryMediaMessage));
        setHasMore(messages.length === PAGE_SIZE);
      })
      .catch((e: unknown) => {
        if (__DEV__) console.warn('[chat-history-media] load failed', e);
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
        if (__DEV__) console.warn('[chat-history-media] load failed', e);
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
    } catch (err) {
      setHasMore(false);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[chat-history-media] load-more failed', err);
      }
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
          keyExtractor={(item, index) => `${item[0]?.clientMsgID ?? 'row'}-${index}`}
          contentContainerStyle={s.listContent}
          onEndReached={() => void handleLoadMore()}
          onEndReachedThreshold={0.3}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={renderSectionHeader}
          renderItem={({ item }) => (
            <View style={s.mediaGrid}>
              {item.map((mediaItem) => (
                <MediaTile
                  key={mediaItem.clientMsgID}
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
