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
import {
  createCircleChatConversation,
  fetchChatMembers,
} from '@/chat-core/api';
import { canViewCircleMembers } from '@/features/chat/group-member-permissions';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { fetchCircleDetail, inviteToCircle } from '@/services/api/circles';
import type { CircleInvitation } from '@/types';
import {
  buildExistingCircleMemberIds,
  filterInvitableCircleFriends,
  pruneSelectedCircleInvitees,
} from '@/features/discover/utils/circle-invite';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
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
  retryButton: {
    marginTop: Spacing.md,
    height: 40,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
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

export default function InviteToCircleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string; title?: string }>();
  const circleId = typeof params.id === 'string' ? params.id : '';

  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [existingMemberIDs, setExistingMemberIDs] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  // review P2：断网/瞬时错误 ≠ 无权限。详情拉取失败单独记态，走"加载失败+重试"，
  // 只有确认拿到详情且角色不足时才显示受限文案。
  const [loadError, setLoadError] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const loadInvitees = useCallback(async (
    signal?: { cancelled: boolean },
    options?: { showInitialLoading?: boolean },
  ) => {
    const showInitialLoading = options?.showInitialLoading ?? true;
    if (showInitialLoading) setLoading(true);
    // review R2：下拉刷新（showInitialLoading=false）期间不预清 authorized——
    // loading 为 false 时清了会立刻把列表替换成受限文案闪一下；授权状态等
    // 刷新后的详情结果落定再更新。
    if (showInitialLoading) setAuthorized(false);
    const [detailResult] = await Promise.allSettled([
      circleId ? fetchCircleDetail(circleId) : Promise.resolve(null),
    ]);
    if (signal?.cancelled || !mountedRef.current) return;
    if (detailResult.status === 'rejected') {
      setLoadError(true);
      setFriends([]);
      setExistingMemberIDs(new Set());
      logClientDiagnostic('circle_invite_detail_load_failed', {
        circleId,
        message:
          detailResult.reason instanceof Error
            ? detailResult.reason.message
            : String(detailResult.reason),
      });
      if (showInitialLoading) setLoading(false);
      return;
    }
    setLoadError(false);
    const detail = detailResult.value;
    const canViewMembers =
      detail?.myStatus === 'ACTIVE' && canViewCircleMembers(detail.myRole);
    setAuthorized(canViewMembers);
    if (!canViewMembers) {
      setFriends([]);
      setExistingMemberIDs(new Set());
      if (showInitialLoading) setLoading(false);
      return;
    }

    const [friendsResult, membersResult] = await Promise.allSettled([
      fetchFriends(),
      createCircleChatConversation(circleId).then((conversation) =>
        fetchChatMembers(conversation.id),
      ),
    ]);
    if (signal?.cancelled || !mountedRef.current) return;

    if (friendsResult.status === 'fulfilled') {
      setFriends(friendsResult.value);
    } else {
      setFriends([]);
      logClientDiagnostic('circle_invite_friends_load_failed', {
        circleId,
        message:
          friendsResult.reason instanceof Error
            ? friendsResult.reason.message
            : String(friendsResult.reason),
      });
    }

    if (membersResult.status === 'fulfilled') {
      setExistingMemberIDs(buildExistingCircleMemberIds(membersResult.value));
    } else {
      setExistingMemberIDs(new Set());
      logClientDiagnostic('circle_invite_members_load_failed', {
        circleId,
        message:
          membersResult.reason instanceof Error
            ? membersResult.reason.message
            : String(membersResult.reason),
      });
    }

    if (!signal?.cancelled && mountedRef.current && showInitialLoading) {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    const signal = { cancelled: false };
    void loadInvitees(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadInvitees]);

  const handleRefreshInvitees = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await loadInvitees(undefined, { showInitialLoading: false });
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [loadInvitees]);

  useEffect(() => {
    setSelected((current) =>
      pruneSelectedCircleInvitees(current, existingMemberIDs),
    );
  }, [existingMemberIDs]);

  const trimmedQuery = query.trim().toLowerCase();
  const invitableFriends = useMemo(
    () => filterInvitableCircleFriends(friends, existingMemberIDs),
    [existingMemberIDs, friends],
  );
  const filteredFriends = useMemo(() => {
    if (!trimmedQuery) return invitableFriends;
    return invitableFriends.filter(
      (friend) =>
        friend.nickname.toLowerCase().includes(trimmedQuery) ||
        friend.accountId.toLowerCase().includes(trimmedQuery),
    );
  }, [invitableFriends, trimmedQuery]);

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const selectedCount = selectedIds.length;

  const toggleFriend = useCallback((id: string) => {
    setSelected((current) => {
      if (current[id]) {
        const { [id]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [id]: true };
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting || !circleId || selectedCount < 1) return;
    const inviteeIds = Object.keys(
      pruneSelectedCircleInvitees(selected, existingMemberIDs),
    );

    if (inviteeIds.length < 1) {
      Alert.alert(
        t('circle.invite.alreadyMembers', {
          defaultValue: '所选好友已在圈子中',
        }),
      );
      setSelected({});
      return;
    }

    setSubmitting(true);
    try {
      // The invite endpoint takes one applicant; fan out and tolerate per-friend
      // rejections (already a member, fails join restrictions, privacy block).
      const results = await Promise.allSettled(
        inviteeIds.map((friendId) => inviteToCircle(circleId, friendId)),
      );
      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<CircleInvitation> =>
          r.status === 'fulfilled',
      );
      const succeeded = fulfilled.length;
      const failed = results.length - succeeded;
      // requiredVerifierCount=1(宣传期默认)时,邀请人的首票已经满票,服务端
      // 当场就把人放进圈子并把担保单落成 APPROVED —— 这时再说「等待验证通过」
      // 是把已经进来的人说成还在排队。按返回的 status 分类报告。
      const joinedNow = fulfilled.filter(
        (r) => r.value.status === 'APPROVED',
      ).length;
      const pending = succeeded - joinedNow;
      if (succeeded === 0) {
        logClientDiagnostic('circle_invite_all_failed', {
          circleId,
          selectedCount: inviteeIds.length,
        });
        Alert.alert(
          t('circle.invite.failed', { defaultValue: '邀请失败' }),
          t('circle.invite.noneSent', {
            defaultValue: '所选好友均未邀请成功，请检查条件后重试',
          }),
        );
        return;
      }
      const successCopy =
        pending === 0
          ? t('circle.invite.joinedAll', {
              count: joinedNow,
              defaultValue: `已把 ${joinedNow} 位好友拉进圈子`,
            })
          : joinedNow === 0
            ? t('circle.invite.sentAll', {
                count: pending,
                defaultValue: `已邀请 ${pending} 位好友，等待验证通过`,
              })
            : t('circle.invite.joinedAndPending', {
                joined: joinedNow,
                pending,
                defaultValue: `${joinedNow} 位已入圈，${pending} 位等待验证通过`,
              });
      const message =
        failed === 0
          ? successCopy
          : t('circle.invite.sentPartial', {
              succeeded,
              failed,
              defaultValue: `已邀请 ${succeeded} 位；${failed} 位未成功（可能已是成员或不满足入圈条件）`,
            });
      if (failed > 0) {
        logClientDiagnostic('circle_invite_partial_failed', {
          circleId,
          succeeded,
          failed,
        });
      }
      Alert.alert(message, undefined, [
        {
          text: t('common.ok', { defaultValue: '好' }),
          onPress: () => router.back(),
        },
      ]);
    } catch (error) {
      Alert.alert(
        t('circle.invite.failed', { defaultValue: '邀请失败' }),
        error instanceof Error ? error.message : String(error),
      );
      logClientDiagnostic('circle_invite_submit_failed', {
        circleId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    circleId,
    existingMemberIDs,
    router,
    selected,
    selectedCount,
    submitting,
    t,
  ]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      surface: { backgroundColor: colors.surface },
      surfaceBorder: { borderColor: colors.surfaceBorder },
      input: { color: colors.text, ...Typography.bodyRegular },
      label: { color: colors.textSecondary, ...Typography.caption },
      rowName: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      rowSubtitle: { color: colors.textSecondary, ...Typography.small },
      emptyText: { color: colors.textSecondary, ...Typography.bodyRegular },
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
        <Pressable
          style={[s.row, d.surface]}
          onPress={() => toggleFriend(item.id)}
        >
          <Avatar
            size={40}
            shape="square"
            name={item.nickname}
            uri={item.avatarUrl ?? undefined}
          />
          <View style={s.rowText}>
            <Text style={d.rowName} numberOfLines={1}>
              {item.nickname}
            </Text>
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
    [colors.primary, colors.textSecondary, d, selected, toggleFriend],
  );

  const submitDisabled = submitting || selectedCount < 1;

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('circle.invite.title', { defaultValue: '邀请好友入圈' })} />

      <View style={[s.searchWrap, d.surface]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, d.input]}
          placeholder={t('circle.invite.searchPlaceholder', {
            defaultValue: '搜索好友',
          })}
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
        {t('circle.invite.subtitle', { defaultValue: '从好友中选择' })}
        {selectedCount > 0 ? ` · ${selectedCount}` : ''}
      </Text>

      {loading ? (
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : loadError ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>
            {t('circle.invite.loadFailed', {
              defaultValue: '圈子信息加载失败，请重试',
            })}
          </Text>
          <Pressable
            style={[s.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => void loadInvitees()}
          >
            <Text style={d.submitText}>
              {t('common.retry', { defaultValue: '重试' })}
            </Text>
          </Pressable>
        </View>
      ) : !authorized ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>{t('chat.groupMembersRestricted')}</Text>
        </View>
      ) : filteredFriends.length === 0 ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>
            {trimmedQuery
              ? t('circle.invite.noMatches', { defaultValue: '没有匹配的好友' })
              : t('circle.invite.noFriends', { defaultValue: '暂无可邀请的好友' })}
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
          refreshing={refreshing}
          onRefresh={handleRefreshInvitees}
        />
      )}

      {authorized && !loadError ? (
        <View
        style={[
          s.footer,
          d.surfaceBorder,
          { paddingBottom: Math.max(insets.bottom, Spacing.md) },
        ]}
      >
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
                ? `${t('circle.invite.submit', { defaultValue: '发送邀请' })} (${selectedCount})`
                : t('circle.invite.submit', { defaultValue: '发送邀请' })}
            </Text>
          )}
        </Pressable>
        </View>
      ) : null}
    </View>
  );
}
