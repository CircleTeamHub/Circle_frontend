import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { useSharePickerStore } from '@/features/chat/store/use-share-picker-store';
import { NoteCard } from '@/features/notes/components/NoteCard';
import type { NoteSummary } from '@/features/notes/types';
import { fetchCollections, type UserCollection } from '@/services/api/collections';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { fetchNotes } from '@/services/api/notes';
import i18n from '@/i18n';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type ShareType = 'note' | 'friend' | 'favorite' | 'quick-reply';

// i18n.t(..., { defaultValue }) — 现有中文用作 fallback，加 key 后会自动切英文。
function shareTitle(type: ShareType): string {
  switch (type) {
    case 'note':
      return i18n.t('share.title.note', { defaultValue: '选择笔记' });
    case 'friend':
      return i18n.t('share.title.friend', { defaultValue: '选择好友名片' });
    case 'favorite':
      return i18n.t('share.title.favorite', { defaultValue: '选择收藏' });
    case 'quick-reply':
      return i18n.t('share.title.quickReply', { defaultValue: '快捷语' });
  }
}

const QUICK_REPLY_DEFAULTS: readonly string[] = [
  '在的，你说',
  '好的，没问题',
  '收到，稍等一下',
  '抱歉刚才没看到消息',
  '今天有点忙，晚点回复',
  '哈哈，太有意思了',
];

function getQuickReplyPhrases(): readonly string[] {
  return QUICK_REPLY_DEFAULTS.map((phrase, index) =>
    i18n.t(`share.quickReply.${index}`, { defaultValue: phrase }),
  );
}

export default function SharePickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { type } = useLocalSearchParams<{ type?: ShareType }>();
  const shareType: ShareType = (type as ShareType) ?? 'note';
  const setPending = useSharePickerStore((s) => s.setPending);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [favorites, setFavorites] = useState<UserCollection[]>([]);
  const [reloadVersion, setReloadVersion] = useState(0);
  const headerTitle = shareTitle(shareType);
  // Memoized：i18n.t 已可缓存，但本地包一层让消费方在 useMemo deps 里能稳定引用。
  const quickReplyPhrases = useMemo(() => getQuickReplyPhrases(), []);

  useEffect(() => {
    if (shareType === 'quick-reply') {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (shareType === 'note') {
          const res = await fetchNotes();
          if (!cancelled) setNotes(res);
        } else if (shareType === 'friend') {
          const res = await fetchFriends();
          if (!cancelled) setFriends(res);
        } else if (shareType === 'favorite') {
          const res = await fetchCollections();
          if (!cancelled) setFavorites(res);
        }
      } catch (err) {
        if (!cancelled) {
          // 不再只 dev-warn —— 暴露给用户 + 提供重试，"加载失败"和"真的空"区分开。
          setError(err instanceof Error ? err.message : '加载失败');
        }
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn(`[share-picker] fetch ${shareType} failed`, err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shareType, reloadVersion]);

  const trimmed = query.trim().toLowerCase();

  const filteredNotes = useMemo(() => {
    if (!trimmed) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(trimmed) ||
        (n.contentPreview ?? '').toLowerCase().includes(trimmed),
    );
  }, [notes, trimmed]);

  const filteredFriends = useMemo(() => {
    if (!trimmed) return friends;
    return friends.filter(
      (f) =>
        f.nickname.toLowerCase().includes(trimmed) ||
        f.accountId.toLowerCase().includes(trimmed),
    );
  }, [friends, trimmed]);

  const filteredFavorites = useMemo(() => {
    if (!trimmed) return favorites;
    return favorites.filter(
      (c) =>
        c.title.toLowerCase().includes(trimmed) ||
        (c.summary ?? '').toLowerCase().includes(trimmed),
    );
  }, [favorites, trimmed]);

  const filteredQuickReply = useMemo(() => {
    if (!trimmed) return quickReplyPhrases;
    return quickReplyPhrases.filter((p) =>
      p.toLowerCase().includes(trimmed),
    );
  }, [quickReplyPhrases, trimmed]);

  const handleSelect = useCallback(
    (item: NoteSummary | FriendProfile | UserCollection | string) => {
      if (shareType === 'note') {
        setPending({ kind: 'note', data: item as NoteSummary });
      } else if (shareType === 'friend') {
        setPending({ kind: 'friend', data: item as FriendProfile });
      } else if (shareType === 'favorite') {
        setPending({ kind: 'favorite', data: item as UserCollection });
      } else {
        setPending({ kind: 'quick-reply', data: item as string });
      }
      router.back();
    },
    [router, setPending, shareType],
  );

  const renderNote = ({ item }: { item: NoteSummary }) => (
    <NoteCard
      note={item}
      onPress={() => handleSelect(item)}
      showActions={false}
    />
  );

  const renderFriend = ({ item }: { item: FriendProfile }) => (
    <Pressable
      style={[s.row, { backgroundColor: colors.surface }]}
      onPress={() => handleSelect(item)}
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
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );

  const renderFavorite = ({ item }: { item: UserCollection }) => (
    <Pressable
      style={[s.row, { backgroundColor: colors.surface }]}
      onPress={() => handleSelect(item)}
    >
      <View style={s.rowText}>
        <Text style={[s.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.summary ? (
          <Text
            style={[s.rowSubtitle, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {item.summary}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );

  const renderQuickReply = ({ item }: { item: string }) => (
    <Pressable
      style={[s.row, { backgroundColor: colors.surface }]}
      onPress={() => handleSelect(item)}
    >
      <Text style={[s.rowTitle, { color: colors.text }]}>{item}</Text>
    </Pressable>
  );

  const empty = !loading && (
    shareType === 'note' ? filteredNotes.length === 0
    : shareType === 'friend' ? filteredFriends.length === 0
    : shareType === 'favorite' ? filteredFavorites.length === 0
    : filteredQuickReply.length === 0
  );

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={s.header}>
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.text }]}>
          {headerTitle}
        </Text>
        <View style={s.headerSpacer} />
      </View>

      <View style={[s.searchWrap, { backgroundColor: colors.surface }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, { color: colors.text }]}
          placeholder="搜索"
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
          <Text style={{ color: colors.error, ...Typography.bodyRegular }}>
            {error}
          </Text>
          <Pressable
            onPress={() => setReloadVersion((v) => v + 1)}
            style={{
              marginTop: Spacing.md,
              paddingHorizontal: Spacing.lg,
              paddingVertical: Spacing.sm,
              borderRadius: Radius.md,
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ color: colors.white, ...Typography.body }}>重试</Text>
          </Pressable>
        </View>
      ) : empty ? (
        <View style={s.center}>
          <Text style={{ color: colors.textSecondary, ...Typography.bodyRegular }}>
            {query ? '没有匹配项' : '暂无内容'}
          </Text>
        </View>
      ) : shareType === 'note' ? (
        <FlatList
          data={filteredNotes}
          keyExtractor={(it) => it.id}
          renderItem={renderNote}
          ItemSeparatorComponent={() => (
            <View style={[s.divider, { backgroundColor: colors.surface }]} />
          )}
          contentContainerStyle={s.noteListContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      ) : shareType === 'friend' ? (
        <FlatList
          data={filteredFriends}
          keyExtractor={(it) => it.id}
          renderItem={renderFriend}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
          keyboardShouldPersistTaps="handled"
        />
      ) : shareType === 'favorite' ? (
        <FlatList
          data={filteredFavorites}
          keyExtractor={(it) => it.id}
          renderItem={renderFavorite}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <FlatList
          data={filteredQuickReply}
          keyExtractor={(it) => it}
          renderItem={renderQuickReply}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
          keyboardShouldPersistTaps="handled"
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    height: 48,
  },
  headerTitle: { ...Typography.h3, fontWeight: '700' },
  headerSpacer: { width: 24 },
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
    ...Typography.bodyRegular,
    lineHeight: 20,
    minHeight: 24,
    paddingVertical: 0,
  },
  noteListContent: {
    paddingBottom: Spacing.xl,
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
  divider: {
    height: 1,
    marginLeft: Spacing.lg,
  },
});
