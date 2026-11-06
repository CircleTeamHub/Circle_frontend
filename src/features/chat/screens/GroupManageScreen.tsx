import { getGroupLogHref, getUserProfileScopeFromSegments } from '@/features/user/utils/routes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useSegments, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import {
  fetchChatMembers,
  refreshConversationOrList,
  setGroupChatMuteAll,
  transferGroupChatOwner,
  updateGroupChatPolicies,
} from '@/chat-core/api';
import { groupPolicyLabel } from '@/chat-core/message-mappers';
import type { ChatGroupPoliciesDto, ChatMemberDto } from '@/chat-core/protocol';
import {
  SILENCE_DURATION_OPTIONS,
  silenceDurationLabel,
  silenceStatusLabel,
} from '@/chat-core/silence-durations';
import { useChatStore } from '@/chat-core/store';
import { GroupMemberPickerSheet } from '@/features/chat/components/group-member-picker-sheet';
import {
  ManageAddRow,
  ManageEmptyRow,
  ManageLinkRow,
  ManageMemberRow,
  ManageSection,
  ManageSwitchRow,
} from '@/features/chat/components/group-manage/GroupManageParts';
import { GroupManageOverview } from '@/features/chat/components/group-manage/GroupManageOverview';
import {
  type GroupRole,
  isGroupManager,
  resolveStandaloneSelfRole,
} from '@/features/chat/group-admin-permissions';
import {
  isSilencedMember,
  useGroupAdminActions,
} from '@/features/chat/hooks/use-group-admin-actions';
import { groupMemberDisplayName } from '@/features/chat/group-member-display';
import { evictGroupInfoCache, writeGroupInfoCache } from '@/features/chat/group-info-cache';
import { useAuthStore } from '@/stores/authStore';
import { getPageSnapshotRevision } from '@/storage/page-snapshots';
import { fetchCircleDetail } from '@/services/api/circles';
import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import {
  groupConversationReloadKey,
  groupOrCircleMutatedSince,
} from '@/features/chat/utils/group-reload-key';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type PickerMode = 'admin' | 'silence' | 'remove' | 'transfer' | null;

/** 群策略开关分两段展示:进群允许方式 / 成员权限。 */
const JOIN_POLICY_KEYS = ['memberCanInvite', 'qrJoinEnabled', 'cardJoinEnabled', 'joinApprovalRequired'] as const;
const MEMBER_POLICY_KEYS = [
  'membersCanViewRoster',
  'membersCanViewProfiles',
  'membersCanAddFriends',
] as const;
type PolicyKey = keyof ChatGroupPoliciesDto;

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.md, gap: Spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  retry: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
  },
});

/**
 * 群管理:设置管理员(群主)、禁言成员、移出成员(群主/管理员)。两种群共用同一页,
 * 差异只在 useGroupAdminActions 里选哪套端点。本人角色每次聚焦都重查,不吃快照。
 */
export default function GroupManageScreen() {
  const sessionKey = useAuthStore((state) => state.user?.id ? `${state.user.id}:${state.sessionEpoch}` : null);
  const { conversationID, groupID } = useLocalSearchParams<{ conversationID?: string; groupID?: string }>();
  return sessionKey ? <GroupManageContent key={`${sessionKey}:${conversationID ?? ''}:${groupID ?? ''}`} /> : null;
}

function GroupManageContent() {
  const scope = getUserProfileScopeFromSegments(useSegments());
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    groupID?: string;
    title?: string;
  }>();
  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const groupID = typeof params.groupID === 'string' ? params.groupID : '';
  const isStandaloneGroup = !groupID;
  const currentUserID = useChatStore((state) => state.currentUserId);
  const ownerId = useChatStore(
    (state) =>
      state.conversations.find((candidate) => candidate.id === conversationID)
        ?.ownerId ?? null,
  );
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  // 与 ChatInfoScreen.groupDataKey 同一套键:两页共用一份成员缓存。
  const groupDataKey = groupID ? `circle:${groupID}` : `standalone:${conversationID}`;
  const [members, setMembers] = useState<ChatMemberDto[]>([]);
  // undefined = 本次进入还没查回圈子详情。
  const [circleRole, setCircleRole] = useState<GroupRole | null | undefined>(undefined);
  // 缓存不是当前授权证明。管理页每次进入都先等成员接口（以及圈子详情）确认
  // 当前座位/角色，避免被踢或撤权后短暂显示旧名单和管理数据。
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const loadedRef = useRef(false);
  // 从入群审核、扩容等页面回来:30 秒内、没有群/圈子写请求、实时字段没变,就不再拉成员
  // 目录 + 圈子详情 + 会话。本页的管理操作都是群写请求,做过就必重拉。
  const conversationReloadKey = useChatStore((state) =>
    groupConversationReloadKey(
      state.conversations.find((candidate) => candidate.id === conversationID),
    ),
  );
  const reloadGate = useFocusReloadGate({
    key: `${conversationID}:${groupID}:${conversationReloadKey}`,
    mutatedSince: groupOrCircleMutatedSince,
  });
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<Set<string>>(
    () => new Set(),
  );
  const [silenceTargets, setSilenceTargets] = useState<ChatMemberDto[]>([]);
  // 设置开关的在途键(含 'muteAll'):同一个开关按下后禁用,避免连点打架。
  const [settingPending, setSettingPending] = useState<string | null>(null);
  const [silenceClock, setSilenceClock] = useState(() => Date.now());

  useEffect(() => {
    const now = Date.now();
    const nextExpiry = members.reduce<number | null>((earliest, member) => {
      if (!member.silenced || !member.silencedUntil) return earliest;
      const expiresAt = new Date(member.silencedUntil).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= now) return earliest;
      return earliest === null || expiresAt < earliest ? expiresAt : earliest;
    }, null);
    if (nextExpiry === null) return;
    const timer = setTimeout(
      () => setSilenceClock(Date.now()),
      Math.max(1, nextExpiry - now + 1),
    );
    return () => clearTimeout(timer);
  }, [members, silenceClock]);

  // 全员禁言与策略都在会话 DTO 上(系统提示到达时 dispatcher 会就地更新它)。
  const muteAll = useChatStore(
    (state) =>
      state.conversations.find((candidate) => candidate.id === conversationID)
        ?.muteAll ?? false,
  );
  const policies = useChatStore(
    (state) =>
      state.conversations.find((candidate) => candidate.id === conversationID)
        ?.policies ?? null,
  );
  const selfRole: GroupRole | null = isStandaloneGroup
    ? resolveStandaloneSelfRole({ members, currentUserID, ownerId })
    : (circleRole ?? null);
  const isOwner = selfRole === 'OWNER';
  const canManage = isGroupManager(selfRole);

  const load = useCallback(async () => {
    if (!conversationID) {
      setLoading(false);
      setError(true);
      return;
    }
    const startedAt = Date.now();
    const requestRevision = getPageSnapshotRevision();
    // 已经有内容时后台刷新,不整屏转圈(回到页面时那一下闪烁)。
    if (!loadedRef.current) setLoading(true);
    setError(false);
    try {
      // 群管理页可能是从圈子详情直接进入的,此时会话 DTO 还不一定在
      // chat store 里。成员权限三个开关读的是会话 DTO 上的 policies;
      // 只拉成员和圈子详情会让 policies 为空,点击随后被静默忽略。
      // 会话列表刷新失败不应阻断成员管理,所以把它单独降级为空结果。
      // 只需要这一个群的 DTO(policies / myRole):单个取,不再为它重拉整张会话列表。
      const conversationsPromise = refreshConversationOrList(conversationID).catch(
        (err: unknown) => {
          reportHandledFailure('groupManage', 'loadPolicies', err);
          return null;
        },
      );
      const [directory, detail] = await Promise.all([
        fetchChatMembers(conversationID),
        groupID ? fetchCircleDetail(groupID) : Promise.resolve(null),
      ]);
      setMembers(directory);
      writeGroupInfoCache(sessionEpoch, groupDataKey, { members: directory }, requestRevision, startedAt);
      setCircleRole(
        detail && detail.myStatus === 'ACTIVE' ? detail.myRole : null,
      );
      // 等待这次快照写入 store,避免开关在旧值/空值上渲染后马上被覆盖。
      await conversationsPromise;
      loadedRef.current = true;
      reloadGate.markLoaded(startedAt);
    } catch (err) {
      // 分不清是被移出群/撤权还是网络抖动:缓存一并作废,下次进来重新拉。
      evictGroupInfoCache(sessionEpoch, groupDataKey);
      setError(true);
      reportHandledFailure('groupManage', 'load', err);
    } finally {
      setLoading(false);
    }
  }, [conversationID, groupDataKey, groupID, reloadGate, sessionEpoch]);

  useFocusEffect(
    useCallback(() => {
      if (reloadGate.shouldSkip()) return;
      void load();
    }, [load, reloadGate]),
  );

  const openActionError = useCallback(
    (err: unknown) => {
      reportHandledFailure('groupManage', 'action', err);
      Alert.alert(
        t('common.errorOccurred'),
        getApiErrorMessage(err, t('common.networkError')),
      );
    },
    [t],
  );

  const groupAdmin = useGroupAdminActions({
    conversationID,
    groupID,
    isStandaloneGroup,
    currentUserID,
    selfRole,
    // 本页就地改了成员:缓存作废(与 ChatInfoScreen 同口径),下次进来不先显示改之前的样子。
    onMemberUpdated: (userId, patch) => {
      evictGroupInfoCache(sessionEpoch, groupDataKey);
      setMembers((current) =>
        current.map((member) =>
          member.userId === userId ? { ...member, ...patch } : member,
        ),
      );
    },
    onMemberRemoved: (userId) => {
      evictGroupInfoCache(sessionEpoch, groupDataKey);
      setMembers((current) => current.filter((member) => member.userId !== userId));
    },
    onError: openActionError,
  });

  const admins = useMemo(
    () => members.filter((member) => member.role === 'ADMIN'),
    [members],
  );
  const silencedMembers = useMemo(
    () => members.filter((member) => isSilencedMember(member, silenceClock)),
    [members, silenceClock],
  );
  const adminCandidates = useMemo(
    () =>
      members.filter(
        (member) => member.role !== 'ADMIN' && groupAdmin.canChangeRole(member),
      ),
    [groupAdmin, members],
  );
  const silenceCandidates = useMemo(
    () =>
      members.filter(
        (member) =>
          !isSilencedMember(member, silenceClock) && groupAdmin.canSilence(member),
      ),
    [groupAdmin, members, silenceClock],
  );
  const removeCandidates = useMemo(
    () => members.filter((member) => groupAdmin.canKick(member)),
    [groupAdmin, members],
  );
  // 转让群主:任何一位在座的其他成员都能接手(服务端只要求在座)。
  const transferCandidates = useMemo(
    () => members.filter((member) => member.userId !== currentUserID),
    [currentUserID, members],
  );

  const silenceOptions = SILENCE_DURATION_OPTIONS.map((seconds) => ({
    label: silenceDurationLabel(seconds),
    value: seconds,
  }));

  /** 会话 DTO 上的字段就地回写(乐观更新;失败时回滚)。 */
  const patchConversation = useCallback(
    (patch: { muteAll?: boolean; policies?: ChatGroupPoliciesDto }) => {
      const store = useChatStore.getState();
      const cached = store.conversations.find(
        (candidate) => candidate.id === conversationID,
      );
      if (!cached) return;
      store.upsertConversation({ ...cached, ...patch });
    },
    [conversationID],
  );

  /**
   * 单个策略键的就地回写:总是基于**当时**缓存里的那份 policies。
   *
   * 回滚不能写回按下开关那一刻捕获的整份快照 —— 请求在途的这段时间里,
   * 别的管理员改了另一个开关、dispatcher 已经把 group-policy-changed 应用上了,
   * 整份快照会把那条远端改动一起抹掉。
   */
  const patchPolicyKey = useCallback(
    (key: PolicyKey, value: boolean) => {
      const store = useChatStore.getState();
      const cached = store.conversations.find(
        (candidate) => candidate.id === conversationID,
      );
      if (!cached?.policies) return;
      store.upsertConversation({
        ...cached,
        policies: { ...cached.policies, [key]: value },
      });
    },
    [conversationID],
  );

  /** 乐观更新失败后把服务端的真实状态重新拉一遍(拉不到就维持回滚值)。 */
  const resyncConversations = useCallback(() => {
    if (!conversationID) return;
    void refreshConversationOrList(conversationID).catch((err: unknown) =>
      reportHandledFailure('groupManage', 'resyncAfterSettingFailure', err),
    );
  }, [conversationID]);

  const handleToggleMuteAll = useCallback(
    (next: boolean) => {
      if (settingPending) return;
      setSettingPending('muteAll');
      patchConversation({ muteAll: next });
      setGroupChatMuteAll(conversationID, next)
        .catch((err: unknown) => {
          patchConversation({ muteAll: !next });
          resyncConversations();
          openActionError(err);
        })
        .finally(() => setSettingPending(null));
    },
    [
      conversationID,
      openActionError,
      patchConversation,
      resyncConversations,
      settingPending,
    ],
  );

  const handleTogglePolicy = useCallback(
    (key: PolicyKey, next: boolean) => {
      if (settingPending || !policies) return;
      const previous = policies[key] ?? true;
      setSettingPending(key);
      patchPolicyKey(key, next);
      updateGroupChatPolicies(conversationID, { [key]: next })
        .then((updated) => patchConversation({ policies: updated }))
        .catch((err: unknown) => {
          patchPolicyKey(key, previous);
          resyncConversations();
          openActionError(err);
        })
        .finally(() => setSettingPending(null));
    },
    [
      conversationID,
      openActionError,
      patchConversation,
      patchPolicyKey,
      policies,
      resyncConversations,
      settingPending,
    ],
  );

  const handleTransferOwner = useCallback(
    (member: ChatMemberDto) => {
      const name = groupMemberDisplayName(member);
      Alert.alert(
        t('chat.transferOwner', { defaultValue: '转让群主' }),
        t('chat.transferOwnerConfirm', { name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('chat.transferOwnerAction', { defaultValue: '转让' }),
            style: 'destructive',
            onPress: () => {
              if (settingPending) return;
              setSettingPending('owner');
              transferGroupChatOwner(conversationID, member.userId)
                .then(() => {
                  Alert.alert(
                    t('common.done'),
                    t('chat.transferOwnerDone', { name }),
                  );
                  // 自己已经不是群主了:重拉成员与角色,页面按新身份收起入口。
                  void load();
                })
                .catch(openActionError)
                .finally(() => setSettingPending(null));
            },
          },
        ],
      );
    },
    [conversationID, load, openActionError, settingPending, t],
  );

  const handleOpenGroupExpansion = useCallback(() => {
    if (!groupID) return;
    // 留在当前栈，按钮、系统返回和侧滑都自然退回这个群管理页。
    router.push({
      pathname: `/(tabs)/${scope}/group-expansion`,
      params: { circleId: groupID },
    } as never);
  }, [groupID, scope]);

  const handleOpenReview = useCallback(() => {
    router.push({
      pathname: `/(tabs)/${scope}/group-review`,
      params: { conversationID, title: params.title },
    } as unknown as Href);
  }, [conversationID, params.title, scope]);

  const handleOpenLog = useCallback(() => {
    router.push(getGroupLogHref(scope, { conversationID, title: params.title }));
  }, [conversationID, params.title, scope]);

  const handleOpenAbnormal = useCallback(() => {
    router.push({
      pathname: `/(tabs)/${scope}/group-abnormal-members`,
      params: groupID ? { conversationID, groupID } : { conversationID },
    } as unknown as Href);
  }, [conversationID, groupID, scope]);

  const openPicker = useCallback((mode: Exclude<PickerMode, null>) => {
    setSelectedMemberIDs(new Set());
    setPickerMode(mode);
  }, []);

  const handleClosePicker = useCallback(() => {
    setSelectedMemberIDs(new Set());
    setPickerMode(null);
  }, []);

  const handleToggleMember = useCallback((member: ChatMemberDto) => {
    setSelectedMemberIDs((current) => {
      const next = new Set(current);
      if (next.has(member.userId)) next.delete(member.userId);
      else next.add(member.userId);
      return next;
    });
  }, []);

  const handlePick = useCallback(
    (member: ChatMemberDto) => {
      const mode = pickerMode;
      handleClosePicker();
      if (mode === 'admin') groupAdmin.changeRole(member, 'ADMIN');
      else if (mode === 'silence') setSilenceTargets([member]);
      else if (mode === 'remove') groupAdmin.kick(member);
      else if (mode === 'transfer') handleTransferOwner(member);
    },
    [groupAdmin, handleClosePicker, handleTransferOwner, pickerMode],
  );

  const handleSelectSilenceDuration = useCallback(
    (seconds: number | null) => {
      const targets = silenceTargets;
      setSilenceTargets([]);
      if (targets.length > 0) void groupAdmin.silenceBatch(targets, seconds);
    },
    [groupAdmin, silenceTargets],
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      centerText: { color: colors.textSecondary, ...Typography.bodyRegular, textAlign: 'center' as const },
      retry: { backgroundColor: colors.primary },
      retryText: { color: colors.white, ...Typography.body },
    }),
    [colors],
  );

  const pickerTitle =
    pickerMode === 'admin'
      ? t('chat.groupManagement.addAdmin', { defaultValue: '添加管理员' })
      : pickerMode === 'silence'
        ? t('chat.groupManagement.addSilence', { defaultValue: '添加禁言' })
        : pickerMode === 'transfer'
          ? t('chat.groupManagement.pickNewOwner', { defaultValue: '选择新群主' })
          : t('chat.groupManagement.removeMembers', { defaultValue: '移出群成员' });
  const pickerMembers =
    pickerMode === 'admin'
      ? adminCandidates
      : pickerMode === 'silence'
        ? silenceCandidates
        : pickerMode === 'transfer'
          ? transferCandidates
          : removeCandidates;

  const handleConfirmPicker = useCallback(() => {
    const mode = pickerMode;
    if (!mode || (mode !== 'admin' && mode !== 'silence')) return;
    const selected = pickerMembers.filter((member) =>
      selectedMemberIDs.has(member.userId),
    );
    if (selected.length === 0) return;
    setSelectedMemberIDs(new Set());
    setPickerMode(null);
    if (mode === 'admin') {
      void groupAdmin.changeRoleBatch(selected, 'ADMIN');
    } else {
      setSilenceTargets(selected);
    }
  }, [groupAdmin, pickerMembers, pickerMode, selectedMemberIDs]);

  const renderPolicyRows = (keys: readonly PolicyKey[]) =>
    keys.map((key, index) => (
      <View key={key}>
        {index > 0 ? <Divider /> : null}
        <ManageSwitchRow
          label={groupPolicyLabel(key)}
          hint={t(`chat.groupPolicyHint.${key}`)}
          value={policies?.[key] ?? true}
          onToggle={(next) => handleTogglePolicy(key, next)}
          disabled={policies === null || Boolean(settingPending)}
        />
      </View>
    ));

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (error) {
    body = (
      <View style={s.center}>
        <Text style={d.centerText}>
          {t('chat.groupManagement.loadFailed', { defaultValue: '群管理加载失败' })}
        </Text>
        <Pressable style={[s.retry, d.retry]} onPress={() => void load()}>
          <Text style={d.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  } else if (!canManage) {
    body = (
      <View style={s.center}>
        <Text style={d.centerText}>
          {t('chat.groupManagement.restricted', {
            defaultValue: '仅群主和管理员可以管理群聊',
          })}
        </Text>
      </View>
    );
  } else {
    body = (
      <ScrollView
        style={s.container}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <GroupManageOverview
          memberCount={members.length}
          adminCount={admins.length}
          silencedCount={silencedMembers.length}
        />

        <ManageSection title={t('chat.groupManagement.memberSection')}>
          <ManageLinkRow
            icon="person-add-outline"
            label={t('groupReview.entry')}
            onPress={handleOpenReview}
            testID="group-manage-applications"
          />
          <Divider />
          <ManageLinkRow
            icon="alert-circle-outline"
            label={t('chat.groupManagement.abnormal.entry')}
            subtitle={t('chat.groupManagement.abnormal.entryHint')}
            onPress={handleOpenAbnormal}
            testID="group-manage-abnormal"
          />
          <Divider />
          <ManageLinkRow
            icon="person-remove-outline"
            label={t('chat.groupManagement.removeMembers', { defaultValue: '移出群成员' })}
            subtitle={t('chat.groupManagement.removeMembersHint', {
              defaultValue: '选择成员并移出群聊',
            })}
            onPress={() => openPicker('remove')}
            testID="group-manage-remove-member"
          />
        </ManageSection>

        {isOwner ? (
          <ManageSection
            title={t('chat.groupManagement.admins', { defaultValue: '群管理员' })}
            hint={t('chat.groupManagement.adminsHint', {
              defaultValue: '管理员可移出普通成员、禁言成员、删除所有人的聊天记录',
            })}
          >
            {admins.length === 0 ? (
              <ManageEmptyRow
                text={t('chat.groupManagement.noAdmins', { defaultValue: '暂无管理员' })}
              />
            ) : (
              admins.map((member) => (
                <ManageMemberRow
                  key={member.userId}
                  name={groupMemberDisplayName(member)}
                  avatarUrl={member.avatarUrl}
                  actionLabel={t('chat.groupManagement.removeAdmin', { defaultValue: '移除' })}
                  pending={groupAdmin.pendingUserID === member.userId}
                  onPress={() => groupAdmin.changeRole(member, 'MEMBER')}
                />
              ))
            )}
            <Divider />
            <ManageAddRow
              label={t('chat.groupManagement.addAdmin', { defaultValue: '添加管理员' })}
              onPress={() => openPicker('admin')}
              testID="group-manage-add-admin"
            />
          </ManageSection>
        ) : null}

        <ManageSection title={t('chat.groupManagement.silenceSection')}>
          <ManageSwitchRow
            label={t('chat.muteAll', { defaultValue: '全员禁言' })}
            hint={t('chat.muteAllHint', { defaultValue: '开启后仅群主和管理员可以发言' })}
            value={muteAll}
            onToggle={handleToggleMuteAll}
            disabled={Boolean(settingPending)}
          />
          <Divider />
          {silencedMembers.length === 0 ? (
            <ManageEmptyRow
              text={t('chat.groupManagement.noSilenced', { defaultValue: '暂无成员被禁言' })}
            />
          ) : (
            silencedMembers.map((member) => (
              <ManageMemberRow
                key={member.userId}
                name={groupMemberDisplayName(member)}
                avatarUrl={member.avatarUrl}
                meta={silenceStatusLabel(member)}
                actionLabel={t('chat.groupManagement.lift', { defaultValue: '解除' })}
                pending={groupAdmin.pendingUserID === member.userId}
                onPress={() => groupAdmin.unsilence(member)}
              />
            ))
          )}
          <Divider />
          <ManageAddRow
            label={t('chat.groupManagement.addSilence', { defaultValue: '添加禁言' })}
            onPress={() => openPicker('silence')}
            testID="group-manage-add-silence"
          />
        </ManageSection>

        <ManageSection
          title={t('chat.groupManagement.joinMethods', { defaultValue: '进群允许方式' })}
        >
          {renderPolicyRows(
            isStandaloneGroup ? JOIN_POLICY_KEYS : ['memberCanInvite', 'qrJoinEnabled'],
          )}
        </ManageSection>

        <ManageSection
          title={t('chat.groupManagement.memberPermissions', { defaultValue: '成员权限' })}
        >
          {renderPolicyRows(MEMBER_POLICY_KEYS)}
        </ManageSection>

        <ManageSection>
          <ManageLinkRow
            icon="document-text-outline"
            label={t('chat.groupLog')}
            onPress={handleOpenLog}
            testID="group-manage-log"
          />
        </ManageSection>

        {isOwner ? (
          <ManageSection title={t('chat.groupManagement.ownerSection', { defaultValue: '群主' })}>
            {/* 圈子群的成员上限走扩容商品;独立群聊固定 200,没有入口。 */}
            {groupID ? (
              <ManageLinkRow
                icon="trending-up-outline"
                label={t('chat.raiseMemberLimit', { defaultValue: '提升成员上限' })}
                onPress={handleOpenGroupExpansion}
                testID="group-manage-raise-limit"
              />
            ) : (
              // 独立群聊才有群主转让:圈子群的圈主转让牵涉会员配额与容量,不在这里。
              <ManageLinkRow
                icon="swap-horizontal-outline"
                label={t('chat.transferOwner', { defaultValue: '转让群主' })}
                destructive
                onPress={() => openPicker('transfer')}
                testID="group-manage-transfer-owner"
              />
            )}
          </ManageSection>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('chat.groupManage', { defaultValue: '群管理' })} />
      {body}
      <GroupMemberPickerSheet
        visible={pickerMode !== null}
        title={pickerTitle}
        members={pickerMembers}
        onSelect={handlePick}
        multiSelect={pickerMode === 'admin' || pickerMode === 'silence'}
        selectedMemberIDs={selectedMemberIDs}
        onToggle={handleToggleMember}
        onConfirm={handleConfirmPicker}
        onClose={handleClosePicker}
      />
      <OptionPickerSheet
        visible={silenceTargets.length > 0}
        title={t('chat.silencePickDuration', { defaultValue: '选择禁言时长' })}
        options={silenceOptions}
        selectedValue={null as number | null}
        onSelect={handleSelectSilenceDuration}
        onClose={() => setSilenceTargets([])}
      />
    </View>
  );
}
