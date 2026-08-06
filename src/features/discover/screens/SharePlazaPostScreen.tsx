import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { fetchPlazaPost } from '@/services/api/plaza';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { toPlazaPostCardData } from '@/features/discover/utils/plaza-post-card';
import { usePendingChatCardStore } from '@/features/chat/store/use-pending-chat-card-store';
import { ensureDirectConversation } from '@/chat-core/client';
import { shouldOpenChatPreview } from '@/features/chat/chat-preview';
import { getChatDetailHref } from '@/features/user/utils/routes';
import type { CirclePlazaPost } from '@/types';

// 分享入口固定在发现栈（与卡片其余导航一致，均按 'discover' scope）。
const SCOPE = 'discover' as const;

export default function SharePlazaPostScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { postId } = useLocalSearchParams<{ postId?: string }>();

  const mountedRef = useRef(true);
  const sendingRef = useRef(false);
  const setPendingChatCard = usePendingChatCardStore((s) => s.setPending);

  const [post, setPost] = useState<CirclePlazaPost | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!postId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [postData, friendList] = await Promise.all([
          fetchPlazaPost(postId),
          fetchFriends(),
        ]);
        if (cancelled) return;
        setPost(postData);
        setFriends(friendList);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : t('share.loadFailed', { defaultValue: '加载失败' }),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, reloadVersion, t]);

  const trimmed = query.trim().toLowerCase();
  const filteredFriends = useMemo(() => {
    if (!trimmed) return friends;
    return friends.filter(
      (f) =>
        f.nickname.toLowerCase().includes(trimmed) ||
        f.accountId.toLowerCase().includes(trimmed),
    );
  }, [friends, trimmed]);

  const handleSelect = useCallback(
    async (friend: FriendProfile) => {
      if (!post || sendingRef.current) return;
      sendingRef.current = true;
      setSendingTo(friend.id);
      // 先构造卡片；仅在聊天目的地解析成功后，紧邻导航写入待发状态。
      const pendingChatCard = {
        conversationKey: friend.id,
        card: toPlazaPostCardData(
          post,
          t('plaza.signup.cardUntitled', { defaultValue: '活动分享' }),
        ),
        draftText: t('plaza.share.opener', {
          defaultValue: '分享给你一个活动，一起来看看',
        }),
      };
      try {
        const conversation = await ensureDirectConversation(friend.id);
        setPendingChatCard(pendingChatCard);
        router.push(
          getChatDetailHref(
            SCOPE,
            friend.id,
            friend.nickname,
            friend.avatarUrl ?? undefined,
            conversation.conversationID,
          ),
        );
      } catch (err) {
        if (shouldOpenChatPreview(err)) {
          setPendingChatCard(pendingChatCard);
          router.push(
            getChatDetailHref(
              SCOPE,
              friend.id,
              friend.nickname,
              friend.avatarUrl ?? undefined,
            ),
          );
          return;
        }
        Alert.alert(
          t('userProfile.openChatFailedTitle', { defaultValue: '打开聊天失败' }),
          err instanceof Error
            ? err.message
            : t('common.networkError', { defaultValue: '网络错误，请重试' }),
        );
      } finally {
        sendingRef.current = false;
        if (mountedRef.current) setSendingTo(null);
      }
    },
    [post, router, setPendingChatCard, t],
  );

  const renderFriend = ({ item }: { item: FriendProfile }) => (
    <Pressable
      style={[s.row, { backgroundColor: colors.surface }]}
      onPress={() => handleSelect(item)}
      disabled={sendingTo !== null}
    >
      <Avatar
        size={40}
        shape="square"
        name={item.nickname}
        uri={item.avatarUrl ?? undefined}
      />
      <View style={s.rowText}>
        <Text style={[s.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {item.nickname}
        </Text>
        <Text
          style={[s.rowSubtitle, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {item.accountId}
        </Text>
      </View>
      {sendingTo === item.id ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      )}
    </Pressable>
  );

  const empty = !loading && !error && filteredFriends.length === 0;

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <NavHeader title={t('plaza.share.title', { defaultValue: '分享给' })} />

      <View style={[s.searchWrap, { backgroundColor: colors.surface }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, { color: colors.text }]}
          placeholder={t('common.search', { defaultValue: '搜索' })}
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <Pressable hitSlop={8} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={{ color: colors.error, ...Typography.body }}>{error}</Text>
          <Pressable
            onPress={() => setReloadVersion((v) => v + 1)}
            style={[s.retry, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: colors.white, ...Typography.body }}>
              {t('common.retry', { defaultValue: '重试' })}
            </Text>
          </Pressable>
        </View>
      ) : empty ? (
        <View style={s.center}>
          <Text style={{ color: colors.textSecondary, ...Typography.body }}>
            {query
              ? t('share.noMatch', { defaultValue: '没有匹配项' })
              : t('plaza.share.noFriends', { defaultValue: '还没有好友可以分享' })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredFriends}
          keyExtractor={(it) => it.id}
          renderItem={renderFriend}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          {...keyboardDismissOnDragProps}
        />
      )}
    </View>
  );
}

function Sep() {
  return <View style={{ height: Spacing.sm }} />;
}

const s = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: {
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    minHeight: 52,
    borderRadius: Radius.md,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
    lineHeight: 20,
    minHeight: 24,
    paddingVertical: 0,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: Spacing.xxl,
    gap: Spacing.md,
  },
  retry: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...Typography.body, fontWeight: '600' },
  rowSubtitle: { ...Typography.small, lineHeight: 18 },
});
