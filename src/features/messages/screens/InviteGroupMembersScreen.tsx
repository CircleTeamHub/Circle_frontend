import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { MemberName } from '@/components/ui/member-name';
import { NavHeader } from '@/components/ui/nav-header';
import { inviteUsersToGroup, loadGroupMemberList, toImUserId } from '@/im/client';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { inviteGroupMembers } from '@/services/api/groups';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
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
  sectionLabel: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
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

export default function InviteGroupMembersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    groupID?: string;
    groupName?: string;
  }>();
  const groupID = typeof params.groupID === 'string' ? params.groupID : '';
  const groupName = typeof params.groupName === 'string' ? params.groupName : t('chat.groupChat');

  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [existingMemberIDs, setExistingMemberIDs] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchFriends(), groupID ? loadGroupMemberList(groupID, 10_000) : Promise.resolve([])])
      .then(([list, members]) => {
        const nextExistingMemberIDs = new Set(members.map((member) => toImUserId(member.userID)));
        if (!cancelled) setFriends(list);
        if (!cancelled) setExistingMemberIDs(nextExistingMemberIDs);
      })
      .catch(() => {
        if (!cancelled) setFriends([]);
        if (!cancelled) setExistingMemberIDs(new Set());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [groupID]);

  useEffect(() => {
    if (existingMemberIDs.size < 1) {
      return;
    }

    setSelected((current) => {
      const nextSelected = { ...current };
      let changed = false;

      for (const id of Object.keys(nextSelected)) {
        if (existingMemberIDs.has(toImUserId(id))) {
          delete nextSelected[id];
          changed = true;
        }
      }

      return changed ? nextSelected : current;
    });
  }, [existingMemberIDs]);

  const trimmedQuery = query.trim().toLowerCase();
  const invitableFriends = useMemo(
    () => friends.filter((friend) => !existingMemberIDs.has(toImUserId(friend.id))),
    [existingMemberIDs, friends],
  );
  const filteredFriends = useMemo(() => {
    if (!trimmedQuery) return invitableFriends;
    return invitableFriends.filter(
      (friend) =>
        friend.nickname.toLowerCase().includes(trimmedQuery) || friend.accountId.toLowerCase().includes(trimmedQuery),
    );
  }, [invitableFriends, trimmedQuery]);

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const selectedCount = selectedIds.length;

  const toggleFriend = useCallback((id: string) => {
    setSelected((current) => {
      if (current[id]) {
        const { [id]: _, ...rest } = current;
        return rest;
      }
      return { ...current, [id]: true };
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!groupID) {
      Alert.alert(t('messages.inviteGroupMembersMissingGroup'));
      return;
    }
    if (selectedCount < 1) {
      Alert.alert(t('messages.inviteGroupMembersMinMembers'));
      return;
    }

    const inviteUserIDs = selectedIds.map(toImUserId).filter((userID) => !existingMemberIDs.has(userID));

    if (inviteUserIDs.length < 1) {
      Alert.alert(t('messages.inviteGroupMembersAlreadyMembers'));
      setSelected({});
      return;
    }

    setSubmitting(true);
    try {
      const result = await inviteGroupMembers(groupID, inviteUserIDs);
      if (!result.handled) {
        await inviteUsersToGroup(groupID, inviteUserIDs);
      }
      Alert.alert(t('messages.inviteGroupMembersSent'), undefined, [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    } catch (error) {
      // 后端会带 errorCode(如对方不接受群邀请);getApiErrorMessage 按码本地化后填进
      // "邀请失败：{{error}}" 文案,而不是直接塞后端英文 message。
      Alert.alert(
        t('messages.inviteGroupMembersFailed', {
          error: getApiErrorMessage(
            error,
            t('common.retryLater', { defaultValue: '请稍后重试' }),
          ),
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }, [existingMemberIDs, groupID, router, selectedCount, selectedIds, submitting, t]);

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.background,
      },
      surface: {
        backgroundColor: colors.surface,
      },
      surfaceBorder: {
        borderColor: colors.surfaceBorder,
      },
      input: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
      label: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      rowName: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      rowSubtitle: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      submitText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FriendProfile>) => {
      const checked = Boolean(selected[item.id]);
      return (
        <Pressable style={[s.row, d.surface]} onPress={() => toggleFriend(item.id)}>
          <Avatar size={40} shape="square" name={item.nickname} uri={item.avatarUrl ?? undefined} />
          <View style={s.rowText}>
            <MemberName
              name={item.nickname}
              userId={item.id}
              style={d.rowName}
              numberOfLines={1}
              animated={false}
            />
            <Text style={d.rowSubtitle} numberOfLines={1}>
              {item.accountId}
            </Text>
          </View>
          <Ionicons
            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={checked ? colors.primary : colors.textSecondary}
          />
        </Pressable>
      );
    },
    [colors.primary, colors.textSecondary, d.rowName, d.rowSubtitle, d.surface, selected, toggleFriend],
  );

  const submitDisabled = submitting || selectedCount < 1;

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('messages.inviteGroupMembersTitle')} />

      <View style={[s.searchWrap, d.surface]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, d.input]}
          placeholder={t('messages.newGroupSearchPlaceholder')}
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

      <Text style={[s.sectionLabel, d.label]}>
        {t('messages.inviteGroupMembersSubtitle', { groupName })}
        {selectedCount > 0 ? ` · ${t('messages.newGroupSelectedCount', { count: selectedCount })}` : ''}
      </Text>

      {loading ? (
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filteredFriends.length === 0 ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>
            {trimmedQuery ? t('messages.newGroupNoMatches') : t('messages.inviteGroupMembersNoInvitableFriends')}
          </Text>
        </View>
      ) : (
        <FlatList
          style={s.scroll}
          data={filteredFriends}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
        {...keyboardDismissOnDragProps}
        />
      )}

      <View style={[s.footer, d.surfaceBorder, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <Pressable
          style={[
            s.submitButton,
            {
              backgroundColor: submitDisabled ? colors.surface : colors.primary,
              opacity: submitDisabled ? 0.6 : 1,
            },
          ]}
          onPress={submitDisabled ? undefined : handleSubmit}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={d.submitText}>
              {selectedCount > 0
                ? `${t('messages.inviteGroupMembersSubmit')} (${selectedCount})`
                : t('messages.inviteGroupMembersSubmit')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
