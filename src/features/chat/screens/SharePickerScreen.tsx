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
import type { NoteSummary } from '@/features/notes/types';
import { fetchCollections, type UserCollection } from '@/services/api/collections';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { fetchNotes } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type ShareType = 'note' | 'friend' | 'favorite' | 'quick-reply';

const TITLES: Record<ShareType, string> = {
  note: '选择笔记',
  friend: '选择好友名片',
  favorite: '选择收藏',
  'quick-reply': '快捷语',
};

const QUICK_REPLY_PHRASES: ReadonlyArray<string> = [
  '在的，你说',
  '好的，没问题',
  '收到，稍等一下',
  '抱歉刚才没看到消息',
  '今天有点忙，晚点回复',
  '哈哈，太有意思了',
];

export default function SharePickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { type } = useLocalSearchParams<{ type?: ShareType }>();
  const shareType: ShareType = (type as ShareType) ?? 'note';
  const setPending = useSharePickerStore((s) => s.setPending);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [favorites, setFavorites] = useState<UserCollection[]>([]);

  useEffect(() => {
    if (shareType === 'quick-reply') {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
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
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shareType]);

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
    if (!trimmed) return QUICK_REPLY_PHRASES;
    return QUICK_REPLY_PHRASES.filter((p) =>
      p.toLowerCase().includes(trimmed),
    );
  }, [trimmed]);

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
    <Pressable
      style={[s.row, { backgroundColor: colors.surface }]}
      onPress={() => handleSelect(item)}
    >
      <View style={s.rowText}>
        <Text style={[s.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.contentPreview ? (
          <Text
            style={[s.rowSubtitle, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {item.contentPreview}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
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
          {TITLES[shareType]}
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
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
          keyboardShouldPersistTaps="handled"
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
    height: 40,
    borderRadius: Radius.md,
  },
  searchInput: { flex: 1, ...Typography.bodyRegular, padding: 0 },
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
});
