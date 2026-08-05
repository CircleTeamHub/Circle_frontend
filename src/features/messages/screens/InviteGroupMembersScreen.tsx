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
import { MemberName } from '@/components/ui/member-name';
import { NavHeader } from '@/components/ui/nav-header';
import {
  inviteUsersToGroup,
  loadGroupMemberList,
  loadSpecifiedGroupMembers,
  toImUserId,
} from '@/im/client';
import {
  loadAuthorizedGroupMembers,
  revalidateGroupMemberView,
} from '@/features/chat/group-member-permissions';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { inviteGroupMembers } from '@/services/api/groups';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { useIMStore } from '@/stores/imStore';

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
  retryButton: {
    marginTop: Spacing.md,
    height: 40,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: '#fff',
    ...Typography.body,
    fontWeight: '600' as const,
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
  const currentUserID = useIMStore((state) => state.currentUserID);

  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [existingMemberIDs, setExistingMemberIDs] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [submitting, setSubmitting] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  // review R3：好友表加载失败 ≠ 无权限——管理员身份已确认但 fetchFriends 因
  // 断网/瞬时错误失败时，走"加载失败+重试"而不是受限文案。
  const [friendsError, setFriendsError] = useState(false);
  const mountedRef = useRef(true);
  // review R3：提交单飞行守（Pattern D 二道闸）——ref 在首个 await 前置位，
  // 同一 tick 的双击都会被挡下，避免并发发出非幂等群邀请。
  const submitInFlightRef = useRef(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const loadScreen = useCallback(async () => {
    setLoading(true);
    setAuthorized(false);
    setFriendsError(false);
    try {
      if (!groupID || !currentUserID) throw new Error('Missing group or current user');
      const result = await loadAuthorizedGroupMembers({
        loadCurrentMember: async () => {
          const [selfMember] = await loadSpecifiedGroupMembers(groupID, [currentUserID]);
          return selfMember ?? null;
        },
        loadMembers: () => loadGroupMemberList(groupID, 10_000),
      });
      if (!mountedRef.current) return;
      setAuthorized(result.authorized);
      if (!result.authorized) {
        setFriends([]);
        setExistingMemberIDs(new Set());
        return;
      }
      // review R2：成员表加载失败 ≠ 无权限——管理员身份已确认时继续放行
      // 邀请（已在群的好友交给服务端拒绝），只记诊断。
      if (result.membersError) {
        logClientDiagnostic('invite_group_members_list_load_failed', {
          groupID,
          message:
            result.membersError instanceof Error
              ? result.membersError.message
              : String(result.membersError),
        });
      }
      setExistingMemberIDs(new Set(result.members.map((member) => toImUserId(member.userID))));
      // review R3：好友表加载单独 try——失败保留已确认的授权，走可重试的
      // 加载错误态，不误显示受限文案。
      try {
        const list = await fetchFriends();
        if (!mountedRef.current) return;
        setFriends(list);
      } catch (error) {
        if (!mountedRef.current) return;
        setFriends([]);
        setFriendsError(true);
        logClientDiagnostic('invite_group_members_friends_load_failed', {
          groupID,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } catch {
      if (mountedRef.current) {
        setFriends([]);
        setExistingMemberIDs(new Set());
        setAuthorized(false);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [currentUserID, groupID]);

  useEffect(() => {
    void loadScreen();
  }, [loadScreen]);

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
    // review R3：单飞行守放在任何 await 之前——同一 tick 的双击都会命中这里，
    // 不会各自通过 submitting 状态判断后并发提交同一份非幂等邀请。
    if (submitInFlightRef.current || submitting) return;
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

    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      // review R2：提交前 fail-closed 重查角色——管理员选好人后被撤权，
      // 缓存的邀请名单不能再发出去。
      const stillAuthorized = await revalidateGroupMemberView({
        loadSelfMember: async () => {
          if (!currentUserID) return null;
          const [selfMember] = await loadSpecifiedGroupMembers(groupID, [currentUserID]);
          return selfMember ?? null;
        },
      });
      if (!stillAuthorized) {
        setAuthorized(false);
        Alert.alert(t('chat.groupMembersRestricted'));
        return;
      }

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
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [currentUserID, existingMemberIDs, groupID, router, selectedCount, selectedIds, submitting, t]);

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
      ) : !authorized ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>{t('chat.groupMembersRestricted')}</Text>
        </View>
      ) : friendsError ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>
            {t('messages.inviteGroupMembersLoadFailed', {
              defaultValue: '好友列表加载失败，请重试',
            })}
          </Text>
          <Pressable
            style={[s.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => void loadScreen()}
          >
            <Text style={s.retryText}>
              {t('common.retry', { defaultValue: '重试' })}
            </Text>
          </Pressable>
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

      {authorized && !friendsError ? (
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
      ) : null}
    </View>
  );
}
