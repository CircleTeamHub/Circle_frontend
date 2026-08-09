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
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryTimeIso,
  getChatMessageDtoTitle,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { searchChatMessages } from '@/chat-core/api';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

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
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
    keyword?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);
  const initialKeyword = typeof params.keyword === 'string' ? params.keyword : '';
  const [keyword, setKeyword] = useState(initialKeyword);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [results, setResults] = useState<ChatMessageDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<number | null>(null);
  const activeKeywordRef = useRef('');
  /**
   * 请求世代。handleSearch 只挡了 loading、没挡 loadingMore ——
   * 关键词 A 的翻页请求还在途时用户改搜 B 是允许的,等 A 那页回来时它会
   * 无条件 append 进 B 的结果里,还把 B 的游标覆盖成 A 的:列表混着两次
   * 搜索的命中,往下翻又继续翻 A。每次新搜索递增,过期的完成一律丢弃。
   */
  const requestGenerationRef = useRef(0);

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

  const handleSearch = useCallback(async (overrideKeyword?: string) => {
    if (loading) {
      return;
    }

    const nextKeyword = (overrideKeyword ?? keyword).trim();
    setSearched(true);
    // 新搜索作废所有在途请求(含另一个关键词的翻页)。
    const generation = (requestGenerationRef.current += 1);

    if (!conversationID || !nextKeyword) {
      setResults([]);
      setHasMore(false);
      // 世代已经递增,在途请求的 finally 会跳过它们的 setLoading(false),
      // 这里必须自己收尾 —— 否则 loading 永远为 true,handleSearch 开头的
      // `if (loading) return` 会把搜索彻底锁死。
      setLoading(false);
      return;
    }

    activeKeywordRef.current = nextKeyword;
    cursorRef.current = null;
    setLoading(true);
    setError(null);

    try {
      const page = await searchChatMessages(conversationID, {
        keyword: nextKeyword,
        types: ['text', 'quote'],
        limit: PAGE_SIZE,
      });
      if (generation !== requestGenerationRef.current) return;
      cursorRef.current = page.nextBeforeHeight;
      setResults([...page.messages].reverse());
      setHasMore(page.nextBeforeHeight !== null);
    } catch (err) {
      if (generation !== requestGenerationRef.current) return;
      setResults([]);
      setHasMore(false);
      setError(t('chat.history.loadFailed'));
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[chat-history-text] search failed', err);
      }
    } finally {
      // 更新的一次搜索已经接管了 loading,别替它关掉。
      if (generation === requestGenerationRef.current) setLoading(false);
    }
  }, [conversationID, keyword, loading, t]);

  useEffect(() => {
    if (initialKeyword) {
      void handleSearch(initialKeyword);
    }
    // 初始关键词只用于首屏自动搜索，后续输入由用户触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !conversationID) {
      return;
    }

    const generation = requestGenerationRef.current;
    setLoadingMore(true);

    try {
      const page = await searchChatMessages(conversationID, {
        keyword: activeKeywordRef.current,
        types: ['text', 'quote'],
        limit: PAGE_SIZE,
        ...(cursorRef.current !== null
          ? { beforeHeight: cursorRef.current }
          : {}),
      });
      // 期间用户换了关键词:这页属于上一次搜索,append 进去会把两次命中混在
      // 一起,还会用旧游标覆盖新搜索的游标。
      if (generation !== requestGenerationRef.current) return;
      cursorRef.current = page.nextBeforeHeight;
      setResults((prev) => [...prev, ...[...page.messages].reverse()]);
      setHasMore(page.nextBeforeHeight !== null);
    } catch (err) {
      if (generation !== requestGenerationRef.current) return;
      // 翻页失败：停止继续翻，留住已加载部分。
      setHasMore(false);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[chat-history-text] load-more failed', err);
      }
    } finally {
      // 这个开关无条件收:它只是本次翻页的进度位,不归新搜索管。
      // 过期请求若不收,loadingMore 会卡在 true,新关键词从此翻不了页。
      setLoadingMore(false);
    }
  }, [conversationID, hasMore, loadingMore]);

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
        title={t('chat.history.textTitle')}
        fallbackHref={getChatDetailHref('messages', sourceID, title, undefined, conversationID)}
      />
      <View style={s.content}>
        <View style={s.searchRow}>
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder={t('chat.history.keywordPlaceholder')}
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
            <Text style={d.actionText}>
              {loading ? t('chat.history.searching') : t('chat.history.search')}
            </Text>
          </Pressable>
        </View>

        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
        {...keyboardDismissOnDragProps}
          onEndReached={() => void handleLoadMore()}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => (
            <Pressable style={[s.resultCard, d.resultCard]} onPress={() => openMessage(item.id)}>
              <Text style={d.title}>{getChatMessageDtoTitle(item)}</Text>
              <Text style={d.meta}>
                {item.sender?.nickname || t('chat.history.unknownSender', { defaultValue: '成员' })} · {formatChatHistoryTimeIso(item.createdAt)}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            error ? (
              <View>
                <Text style={[s.centeredText, d.errorText]}>{error}</Text>
                <Pressable style={d.retryButton} onPress={() => void handleSearch()}>
                  <Text style={d.retryText}>{t('chat.history.retry')}</Text>
                </Pressable>
              </View>
            ) : searched ? (
              <Text style={[s.centeredText, d.centeredText]}>
                {t('chat.history.noMatches')}
              </Text>
            ) : null
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
