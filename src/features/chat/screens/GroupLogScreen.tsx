import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import { searchChatMessages } from '@/chat-core/api';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { systemNoticeText } from '@/chat-core/message-mappers';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const PAGE_SIZE = 100;

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.sm },
  card: { padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, gap: Spacing.xs },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  retry: { marginTop: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.lg },
});

function getSystemLogText(message: ChatMessageDto): string {
  const localized = systemNoticeText(message.content);
  if (localized) return localized;
  for (const key of ['text', 'message', 'title', 'description']) {
    const value = message.content[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function mergeGroupLogEntries(
  current: ChatMessageDto[],
  incoming: ChatMessageDto[],
) {
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

export default function GroupLogScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ conversationID?: string; title?: string }>();
  const conversationID = typeof params.conversationID === 'string' ? params.conversationID : '';
  const [entries, setEntries] = useState<ChatMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const cursorRef = useRef<number | null>(null);
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
      const page = await searchChatMessages(conversationID, {
        types: ['system'],
        limit: PAGE_SIZE,
      });
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      cursorRef.current = page.nextBeforeHeight;
      setEntries([...page.messages].reverse());
      setHasMore(page.nextBeforeHeight !== null);
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
    if (
      !conversationID ||
      !hasMore ||
      cursor === null ||
      loadingMoreRef.current
    ) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const generation = requestGenerationRef.current;
    try {
      const page = await searchChatMessages(conversationID, {
        types: ['system'],
        limit: PAGE_SIZE,
        beforeHeight: cursor,
      });
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      cursorRef.current = page.nextBeforeHeight;
      setEntries((current) =>
        mergeGroupLogEntries(current, [...page.messages].reverse()),
      );
      setHasMore(page.nextBeforeHeight !== null);
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
              <Text style={d.text}>{getSystemLogText(item) || t('chat.groupActivity', { defaultValue: '群聊活动' })}</Text>
              <Text style={d.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}
