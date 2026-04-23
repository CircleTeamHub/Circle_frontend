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
import type { MessageItem } from '@openim/rn-client-sdk';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryTime,
  getChatHistoryMessageTitle,
  isValidDateInput,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchConversationMessagesByDate } from '@/im/client';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const PAGE_SIZE = 50;

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
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  listContent: {
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});

export default function ChatHistoryDateScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);
  const [date, setDate] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [results, setResults] = useState<MessageItem[]>([]);
  const mountedRef = useRef(true);
  const pageRef = useRef(1);
  const activeDateRef = useRef('');

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
      card: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      title: { color: colors.text, ...Typography.body },
      meta: { color: colors.textSecondary, ...Typography.small },
      centeredText: { color: colors.textSecondary, ...Typography.bodyRegular },
    }),
    [colors],
  );

  const handleSearch = useCallback(async () => {
    if (loading) {
      return;
    }

    const nextDate = date.trim();
    setSearched(true);

    if (!conversationID || !isValidDateInput(nextDate)) {
      setResults([]);
      setHasMore(false);
      return;
    }

    activeDateRef.current = nextDate;
    pageRef.current = 1;
    setLoading(true);

    try {
      const page = await searchConversationMessagesByDate({
        conversationID,
        date: nextDate,
        pageIndex: 1,
        count: PAGE_SIZE,
      });

      if (mountedRef.current) {
        setResults(page);
        setHasMore(page.length === PAGE_SIZE);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [conversationID, date, loading]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !conversationID) {
      return;
    }

    const nextPage = pageRef.current + 1;
    setLoadingMore(true);

    try {
      const page = await searchConversationMessagesByDate({
        conversationID,
        date: activeDateRef.current,
        pageIndex: nextPage,
        count: PAGE_SIZE,
      });

      if (mountedRef.current) {
        pageRef.current = nextPage;
        setResults((prev) => [...prev, ...page]);
        setHasMore(page.length === PAGE_SIZE);
      }
    } finally {
      if (mountedRef.current) {
        setLoadingMore(false);
      }
    }
  }, [conversationID, hasMore, loadingMore]);

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
        title="按日期"
        fallbackHref={getChatDetailHref(sourceID, title, undefined, conversationID)}
      />
      <View style={s.content}>
        <View style={s.searchRow}>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
            style={[s.input, d.input]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            onSubmitEditing={() => void handleSearch()}
          />
          <Pressable
            style={[s.actionButton, d.actionButton]}
            onPress={() => void handleSearch()}
            disabled={loading}
          >
            <Text style={d.actionText}>{loading ? '查询中' : '查询'}</Text>
          </Pressable>
        </View>

        <FlatList
          data={results}
          keyExtractor={(item) => item.clientMsgID}
          contentContainerStyle={s.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => void handleLoadMore()}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => (
            <Pressable style={[s.card, d.card]} onPress={() => openMessage(item.clientMsgID)}>
              <Text style={d.title}>{getChatHistoryMessageTitle(item)}</Text>
              <Text style={d.meta}>{formatChatHistoryTime(item.sendTime)}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={[s.centeredText, d.centeredText]}>
              {searched ? '暂无该日期的聊天记录' : '请选择日期'}
            </Text>
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
