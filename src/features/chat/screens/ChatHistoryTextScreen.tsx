import { useCallback, useMemo, useRef, useState } from 'react';
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
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchConversationTextMessages } from '@/im/client';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

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
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);
  const [keyword, setKeyword] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [results, setResults] = useState<MessageItem[]>([]);
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
    }),
    [colors],
  );

  const handleSearch = useCallback(async () => {
    if (loading) {
      return;
    }

    const nextKeyword = keyword.trim();
    setSearched(true);

    if (!conversationID || !nextKeyword) {
      setResults([]);
      setHasMore(false);
      return;
    }

    activeKeywordRef.current = nextKeyword;
    pageRef.current = 1;
    setLoading(true);

    try {
      const page = await searchConversationTextMessages({
        conversationID,
        keyword: nextKeyword,
        pageIndex: 1,
        count: PAGE_SIZE,
      });
      setResults(page);
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, [conversationID, keyword, loading]);

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
    } finally {
      setLoadingMore(false);
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
        title="搜索文字消息"
        fallbackHref={getChatDetailHref(sourceID, title, undefined, conversationID)}
      />
      <View style={s.content}>
        <View style={s.searchRow}>
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="输入关键词"
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
            <Text style={d.actionText}>{loading ? '搜索中' : '搜索'}</Text>
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
            <Pressable style={[s.resultCard, d.resultCard]} onPress={() => openMessage(item.clientMsgID)}>
              <Text style={d.title}>{getChatHistoryMessageTitle(item)}</Text>
              <Text style={d.meta}>
                {item.senderNickname || item.sendID} · {formatChatHistoryTime(item.sendTime)}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            searched ? (
              <Text style={[s.centeredText, d.centeredText]}>
                暂无匹配的聊天记录
              </Text>
            ) : null
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
