import { useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { NavHeader } from '@/components/ui/nav-header';
import { mapConversationItemToUI } from '@/im/mappers';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { useIMStore } from '@/stores/imStore';
import { getUserProfileHref, type UserProfileScope } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { Conversation } from '@/types';

type ChatResult = {
  kind: 'chat';
  data: Conversation;
};

type ContactResult = {
  kind: 'contact';
  data: FriendProfile;
};

type SearchResultItem = ChatResult | ContactResult;

type SearchSection = {
  title: string;
  data: SearchResultItem[];
};

const s = StyleSheet.create({
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  headerContent: {
    gap: Spacing.lg,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.xxl,
    borderWidth: 1,
  },
  sectionHeader: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  resultBody: {
    flex: 1,
    gap: Spacing.xs,
  },
  resultTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  loadingWrap: {
    paddingTop: Spacing.xl,
    alignItems: 'center',
  },
});

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const rawConversations = useIMStore((state) => state.conversations);
  const conversations = useMemo(
    () => rawConversations.map(mapConversationItemToUI),
    [rawConversations],
  );

  const currentScope: UserProfileScope = useMemo(() => {
    const scope = segments.find(
      (segment) => segment === 'contacts' || segment === 'profile',
    );

    if (scope === 'contacts') return 'contacts';
    if (scope === 'profile') return 'profile';
    return 'messages';
  }, [segments]);

  const loadFriends = useCallback(
    (signal?: { cancelled: boolean }) => {
      setFriendsLoading(true);
      setLoadError(null);
      fetchFriends()
        .then((list) => {
          if (!signal?.cancelled) setFriends(list);
        })
        .catch((error) => {
          if (signal?.cancelled) return;
          setFriends([]);
          setLoadError(
            t('search.loadFriendsFailed', {
              defaultValue: '好友列表加载失败，请稍后重试',
            }),
          );
          if (__DEV__) {
            console.warn('[SearchScreen] fetchFriends failed', error);
          }
        })
        .finally(() => {
          if (!signal?.cancelled) setFriendsLoading(false);
        });
    },
    [t],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    loadFriends(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadFriends]);

  const trimmedQuery = query.trim().toLowerCase();

  const sections = useMemo<SearchSection[]>(() => {
    if (!trimmedQuery) {
      return [];
    }

    const matchedChats: ChatResult[] = conversations
      .filter((conversation) => {
        const haystack = `${conversation.name}${conversation.message ?? ''}`.toLowerCase();
        return haystack.includes(trimmedQuery);
      })
      .map((conversation) => ({ kind: 'chat' as const, data: conversation }));

    const matchedFriends: ContactResult[] = friends
      .filter((friend) => {
        const haystack = `${friend.nickname}${friend.accountId}`.toLowerCase();
        return haystack.includes(trimmedQuery);
      })
      .map((friend) => ({ kind: 'contact' as const, data: friend }));

    const out: SearchSection[] = [];
    if (matchedChats.length > 0) {
      out.push({
        title: t('search.sections.chats', { defaultValue: '聊天记录' }),
        data: matchedChats,
      });
    }
    if (matchedFriends.length > 0) {
      out.push({
        title: t('search.sections.friends', { defaultValue: '好友' }),
        data: matchedFriends,
      });
    }
    return out;
  }, [conversations, friends, t, trimmedQuery]);

  const handlePressChat = (conversation: Conversation) => {
    // router.push 会把 params 通过 URL 序列化；avatarUrl 为 falsy（null/undefined/空串）时会变
    // 成字符串 "null" / "undefined"，下游误以为有值。只传存在的值。
    const params: Record<string, string> = {
      conversationID: conversation.id,
      sourceID: conversation.sourceID,
      title: conversation.name,
      conversationType: conversation.conversationType,
    };
    if (conversation.avatarUrl) {
      params.avatarUrl = conversation.avatarUrl;
    }
    router.push({
      pathname: '/(tabs)/messages/chat-detail',
      params,
    });
  };

  const handlePressFriend = (friend: FriendProfile) => {
    router.push(getUserProfileHref(currentScope, friend.id, friend.nickname));
  };

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      listContent: {
        paddingBottom: insets.bottom + Spacing.xl,
      },
      searchBox: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      input: {
        flex: 1,
        color: colors.text,
        ...Typography.bodyRegular,
        padding: 0,
      },
      sectionTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      resultTitle: {
        color: colors.text,
        fontSize: 15,
        fontWeight: '600' as const,
        flex: 1,
        marginRight: Spacing.sm,
      },
      resultSubtitle: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      resultMeta: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
        paddingTop: Spacing.xl,
      },
    }),
    [colors, insets.bottom],
  );

  const renderItem = ({ item }: { item: SearchResultItem }) => {
    if (item.kind === 'chat') {
      const conversation = item.data;
      return (
        <Pressable style={s.resultRow} onPress={() => handlePressChat(conversation)}>
          <Avatar size={40} name={conversation.name} uri={conversation.avatarUrl} />
          <View style={s.resultBody}>
            <View style={s.resultTopRow}>
              <Text style={d.resultTitle} numberOfLines={1}>
                {conversation.name}
              </Text>
              {conversation.time ? (
                <Text style={d.resultMeta}>{conversation.time}</Text>
              ) : null}
            </View>
            <Text style={d.resultSubtitle} numberOfLines={1}>
              {conversation.message || ' '}
            </Text>
          </View>
        </Pressable>
      );
    }

    const friend = item.data;
    return (
      <Pressable style={s.resultRow} onPress={() => handlePressFriend(friend)}>
        <Avatar size={40} name={friend.nickname} uri={friend.avatarUrl ?? undefined} />
        <View style={s.resultBody}>
          <Text style={d.resultTitle} numberOfLines={1}>
            {friend.nickname}
          </Text>
          <Text style={d.resultSubtitle} numberOfLines={1}>
            {friend.accountId}
          </Text>
        </View>
      </Pressable>
    );
  };

  const showLoading = trimmedQuery.length === 0 && friendsLoading;

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('search.title', { defaultValue: '搜索' })} />
      <SectionList
        sections={sections}
        keyExtractor={(item) =>
          item.kind === 'chat' ? `chat-${item.data.id}` : `friend-${item.data.id}`
        }
        contentContainerStyle={[s.listContent, d.listContent]}
        stickySectionHeadersEnabled={false}
        {...keyboardDismissOnDragProps}
        ListHeaderComponent={
          <View style={s.headerContent}>
            <View style={[s.searchBox, d.searchBox]}>
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                style={d.input}
                value={query}
                onChangeText={setQuery}
                placeholder={t('search.placeholder', {
                  defaultValue: '搜索聊天记录、好友',
                })}
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {query ? (
                <Pressable hitSlop={8} onPress={() => setQuery('')}>
                  <Ionicons
                    name="close-circle"
                    size={16}
                    color={colors.textSecondary}
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHeader}>
            <Text style={d.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View>
            {renderItem({ item })}
            {index < section.data.length - 1 ? <Divider /> : null}
          </View>
        )}
        ListEmptyComponent={
          showLoading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : loadError && friends.length === 0 ? (
            <View style={s.loadingWrap}>
              <Text style={d.emptyText}>{loadError}</Text>
              <Pressable
                onPress={() => loadFriends()}
                style={{
                  marginTop: Spacing.md,
                  paddingHorizontal: Spacing.md,
                  paddingVertical: Spacing.sm,
                  borderRadius: Radius.xxl,
                  backgroundColor: colors.primary,
                }}
              >
                <Text style={{ color: colors.white, ...Typography.caption }}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={d.emptyText}>
              {trimmedQuery
                ? t('search.noResults', { defaultValue: '暂无匹配结果' })
                : t('search.placeholderHint', {
                    defaultValue: '输入关键字搜索聊天记录、好友',
                  })}
            </Text>
          )
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
