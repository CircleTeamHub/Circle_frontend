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
  type ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { fetchChatMembers, inviteGroupChatMembers } from '@/chat-core/api';
import { useChatStore } from '@/chat-core/store';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { reportHandledFailure } from '@/observability/report-failure';

const s = StyleSheet.create({
  container: { flex: 1 },
  subtitle: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  searchWrap: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: Radius.md,
  },
  searchInput: { flex: 1, padding: 0 },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
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
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.xxl,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const Sep = () => <View style={{ height: Spacing.xs }} />;

/** 独立群聊的「邀请好友」:好友多选直接进群(区别于圈子群的担保邀请流程)。 */
export default function InviteGroupMembersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    title?: string;
  }>();
  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const groupName = typeof params.title === 'string' ? params.title : '';

  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [memberIDs, setMemberIDs] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!conversationID) return;
    let cancelled = false;
    (async () => {
      try {
        const [friendList, members] = await Promise.all([
          fetchFriends(),
          fetchChatMembers(conversationID),
        ]);
        if (cancelled) return;
        setFriends(friendList);
        setMemberIDs(new Set(members.map((member) => member.userId)));
      } catch (error) {
        reportHandledFailure('group', 'loadInviteCandidates', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationID]);

  // 已在群里的好友不再出现在候选里(邀请了也是服务端 no-op,徒增困惑)。
  const invitableFriends = useMemo(
    () => friends.filter((friend) => !memberIDs.has(friend.id)),
    [friends, memberIDs],
  );

  const visibleFriends = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return invitableFriends;
    return invitableFriends.filter((friend) =>
      `${friend.remark ?? ''} ${friend.nickname} ${friend.accountId}`
        .toLowerCase()
        .includes(keyword),
    );
  }, [invitableFriends, query]);

  const selectedCount = Object.keys(selected).length;
  const canSubmit = selectedCount >= 1 && !submitting;

  const toggle = useCallback((friendId: string) => {
    setSelected((prev) => {
      if (prev[friendId]) {
        const next = { ...prev };
        delete next[friendId];
        return next;
      }
      return { ...prev, [friendId]: true };
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!conversationID) {
      Alert.alert(t('messages.inviteGroupMembersMissingGroup'));
      return;
    }
    if (selectedCount < 1) {
      Alert.alert(t('messages.inviteGroupMembersMinMembers'));
      return;
    }
    setSubmitting(true);
    try {
      const dto = await inviteGroupChatMembers(
        conversationID,
        Object.keys(selected),
      );
      useChatStore.getState().upsertConversation(dto);
      if (!mountedRef.current) return;
      Alert.alert(t('messages.inviteGroupMembersSent'));
      router.back();
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert(
          t('messages.inviteGroupMembersFailed', {
            error: getApiErrorMessage(error, t('common.networkError')),
          }),
        );
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }, [conversationID, router, selected, selectedCount, t]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FriendProfile>) => {
      const checked = Boolean(selected[item.id]);
      const displayName = item.remark?.trim() || item.nickname;
      return (
        <Pressable
          style={[s.row, { backgroundColor: colors.surface }]}
          onPress={() => toggle(item.id)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={displayName}
        >
          <Ionicons
            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={checked ? colors.primary : colors.textSecondary}
          />
          <Avatar name={displayName} uri={item.avatarUrl ?? undefined} size={40} />
          <View style={s.rowText}>
            <Text style={{ color: colors.text, ...Typography.body }} numberOfLines={1}>
              {displayName}
            </Text>
          </View>
        </Pressable>
      );
    },
    [colors, selected, toggle],
  );

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <NavHeader
        title={t('messages.inviteGroupMembersTitle')}
        fallbackHref="/(tabs)/messages"
      />
      {groupName ? (
        <Text
          style={{
            color: colors.textSecondary,
            ...Typography.caption,
            ...s.subtitle,
          }}
        >
          {t('messages.inviteGroupMembersSubtitle', { groupName })}
        </Text>
      ) : null}

      <View style={[s.searchWrap, { backgroundColor: colors.surface }]}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('messages.newGroupSearchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={[s.searchInput, { color: colors.text, ...Typography.body }]}
        />
      </View>

      {loading ? (
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={visibleFriends}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
          {...keyboardDismissOnDragProps}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={{ color: colors.textSecondary, ...Typography.body }}>
                {t(
                  invitableFriends.length === 0
                    ? 'messages.inviteGroupMembersNoInvitableFriends'
                    : 'messages.newGroupNoMatches',
                )}
              </Text>
            </View>
          }
        />
      )}

      <View
        style={[
          s.footer,
          {
            borderTopColor: colors.surfaceBorder,
            paddingBottom: Math.max(insets.bottom, Spacing.md),
            backgroundColor: colors.background,
          },
        ]}
      >
        <Pressable
          style={[
            s.submitButton,
            {
              backgroundColor: canSubmit ? colors.primary : colors.surfaceBorder,
            },
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={t('messages.inviteGroupMembersSubmit')}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={{ color: colors.white, ...Typography.body, fontWeight: '600' }}>
              {selectedCount > 0
                ? `${t('messages.inviteGroupMembersSubmit')} · ${t('messages.newGroupSelectedCount', { count: selectedCount })}`
                : t('messages.inviteGroupMembersSubmit')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
