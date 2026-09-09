import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { fetchChatGroupEvents } from '@/chat-core/api';
import { groupEventText } from '@/chat-core/group-events';
import type { ChatGroupEventDto } from '@/chat-core/protocol';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const PAGE_SIZE = 50;

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: Spacing.xs },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  retry: { marginTop: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.lg },
});

/** 每种事件一个图标;未知种类用通用图标(文案已由 groupEventText 兜底)。 */
const EVENT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'group-created': 'sparkles-outline',
  'member-joined': 'person-add-outline',
  'member-left': 'exit-outline',
  'member-removed': 'person-remove-outline',
  'member-role-changed': 'shield-checkmark-outline',
  'member-silenced': 'volume-mute-outline',
  'member-unsilenced': 'volume-high-outline',
  'owner-transferred': 'key-outline',
  'group-renamed': 'create-outline',
  'group-notice-updated': 'megaphone-outline',
  'history-cleared': 'trash-outline',
};

/** 翻页合并去重:服务端在两页之间新增事件时,游标页可能重叠一条。 */
export function mergeGroupLogEntries<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const seen = new Set(current.map((entry) => entry.id));
  return [
    ...current,
    ...incoming.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    }),
  ];
}

/**
 * 群日志:读的是独立于聊天记录的群事件账本(GET /chat/conversations/:id/events),
 * 不受清空/焚毁影响,后入群的人也能翻到入群前的记录。倒序游标分页。
 */
export default function GroupLogScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ conversationID?: string; title?: string }>();
  const conversationID = typeof params.conversationID === 'string' ? params.conversationID : '';
  const [entries, setEntries] = useState<ChatGroupEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const mountedRef = useRef(true);

  const loadFirstPage = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    cursorRef.current = null;
    setEntries([]);
    if (!conversationID) {
      setLoading(false);
      setError(true);
      setHasMore(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const page = await fetchChatGroupEvents(conversationID, { limit: PAGE_SIZE });
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      cursorRef.current = page.nextCursor;
      setEntries(page.events);
      setHasMore(page.nextCursor !== null);
    } catch (err) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      setError(true);
      reportHandledFailure('groupLog', 'load', err);
    } finally {
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [conversationID]);

  useEffect(() => {
    void loadFirstPage();
    return () => {
      requestGenerationRef.current += 1;
    };
  }, [loadFirstPage]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!conversationID || !hasMore || cursor === null || loadingMoreRef.current) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const generation = requestGenerationRef.current;
    try {
      const page = await fetchChatGroupEvents(conversationID, {
        limit: PAGE_SIZE,
        cursor,
      });
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      // 服务端游标不前进就停:否则触底事件会在同一页上无限打转。
      if (page.nextCursor === cursor) {
        cursorRef.current = null;
        setHasMore(false);
      } else {
        cursorRef.current = page.nextCursor;
        setHasMore(page.nextCursor !== null);
      }
      setEntries((current) => mergeGroupLogEntries(current, page.events));
    } catch (err) {
      if (mountedRef.current && generation === requestGenerationRef.current) {
        reportHandledFailure('groupLog', 'loadMore', err);
      }
    } finally {
      if (generation === requestGenerationRef.current) {
        loadingMoreRef.current = false;
        if (mountedRef.current) setLoadingMore(false);
      }
    }
  }, [conversationID, hasMore]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      iconWrap: { backgroundColor: colors.background },
      text: { color: colors.text, ...Typography.bodyRegular },
      meta: { color: colors.textSecondary, ...Typography.small },
      empty: { color: colors.textSecondary, ...Typography.bodyRegular, textAlign: 'center' as const },
      retry: { backgroundColor: colors.primary },
      retryText: { color: colors.white, ...Typography.body },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('chat.groupLog', { defaultValue: '群日志' })} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={s.center}>
          <Text style={d.empty}>{t('chat.groupLogLoadFailed', { defaultValue: '群日志加载失败' })}</Text>
          <Pressable style={[s.retry, d.retry]} onPress={() => void loadFirstPage()}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="group-log-list"
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={entries.length ? s.content : s.center}
          ListEmptyComponent={<Text style={d.empty}>{t('chat.noGroupLog', { defaultValue: '暂无群日志' })}</Text>}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.primary} /> : null
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => (
            <View style={[s.card, d.card]}>
              <View style={[s.iconWrap, d.iconWrap]}>
                <Ionicons
                  name={EVENT_ICONS[item.kind] ?? 'time-outline'}
                  size={18}
                  color={colors.textSecondary}
                />
              </View>
              <View style={s.cardBody}>
                <Text style={d.text}>{groupEventText(item)}</Text>
                <Text style={d.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
