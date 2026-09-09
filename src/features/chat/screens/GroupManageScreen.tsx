import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import {
  fetchChatMembers,
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
  type GroupRole,
  isGroupManager,
  resolveStandaloneSelfRole,
} from '@/features/chat/group-admin-permissions';
import {
  isSilencedMember,
  useGroupAdminActions,
} from '@/features/chat/hooks/use-group-admin-actions';
import { groupMemberDisplayName } from '@/features/chat/group-member-display';
import { fetchCircleDetail } from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type PickerMode = 'admin' | 'silence' | 'remove' | 'transfer' | null;

/** 群策略开关分两段展示:进群允许方式 / 成员权限。 */
const JOIN_POLICY_KEYS = ['memberCanInvite', 'qrJoinEnabled'] as const;
const MEMBER_POLICY_KEYS = [
  'membersCanViewProfiles',
  'membersCanAddFriends',
] as const;
type PolicyKey = keyof ChatGroupPoliciesDto;

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.lg },
  section: { borderRadius: Radius.xl, overflow: 'hidden' },
  sectionHeader: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 56,
  },
  rowText: { flex: 1, gap: 2 },
  rowAction: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  emptyRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
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
  const [members, setMembers] = useState<ChatMemberDto[]>([]);
  const [circleRole, setCircleRole] = useState<GroupRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [silenceTarget, setSilenceTarget] = useState<ChatMemberDto | null>(null);
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
    : circleRole;
  const isOwner = selfRole === 'OWNER';
  const canManage = isGroupManager(selfRole);

  const load = useCallback(async () => {
    if (!conversationID) {
      setLoading(false);
      setError(true);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const [directory, detail] = await Promise.all([
        fetchChatMembers(conversationID),
        groupID ? fetchCircleDetail(groupID) : Promise.resolve(null),
      ]);
      setMembers(directory);
      setCircleRole(
        detail && detail.myStatus === 'ACTIVE' ? detail.myRole : null,
      );
    } catch (err) {
      setError(true);
      reportHandledFailure('groupManage', 'load', err);
    } finally {
      setLoading(false);
    }
  }, [conversationID, groupID]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
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
    onMemberUpdated: (userId, patch) =>
      setMembers((current) =>
        current.map((member) =>
          member.userId === userId ? { ...member, ...patch } : member,
        ),
      ),
    onMemberRemoved: (userId) =>
      setMembers((current) => current.filter((member) => member.userId !== userId)),
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

  const handleToggleMuteAll = useCallback(
    (next: boolean) => {
      if (settingPending) return;
      setSettingPending('muteAll');
      patchConversation({ muteAll: next });
      setGroupChatMuteAll(conversationID, next)
        .catch((err: unknown) => {
          patchConversation({ muteAll: !next });
          openActionError(err);
        })
        .finally(() => setSettingPending(null));
    },
    [conversationID, openActionError, patchConversation, settingPending],
  );

  const handleTogglePolicy = useCallback(
    (key: PolicyKey, next: boolean) => {
      if (settingPending || !policies) return;
      setSettingPending(key);
      patchConversation({ policies: { ...policies, [key]: next } });
      updateGroupChatPolicies(conversationID, { [key]: next })
        .then((updated) => patchConversation({ policies: updated }))
        .catch((err: unknown) => {
          patchConversation({ policies });
          openActionError(err);
        })
        .finally(() => setSettingPending(null));
    },
    [conversationID, openActionError, patchConversation, policies, settingPending],
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
    router.push({
      pathname: '/(tabs)/profile/group-expansion',
      params: { circleId: groupID },
    } as never);
  }, [groupID]);

  const handlePick = useCallback(
    (member: ChatMemberDto) => {
      const mode = pickerMode;
      setPickerMode(null);
      if (mode === 'admin') groupAdmin.changeRole(member, 'ADMIN');
      else if (mode === 'silence') setSilenceTarget(member);
      else if (mode === 'remove') groupAdmin.kick(member);
      else if (mode === 'transfer') handleTransferOwner(member);
    },
    [groupAdmin, handleTransferOwner, pickerMode],
  );

  const handleSelectSilenceDuration = useCallback(
    (seconds: number | null) => {
      const target = silenceTarget;
      setSilenceTarget(null);
      if (target) groupAdmin.silence(target, seconds);
    },
    [groupAdmin, silenceTarget],
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      section: { backgroundColor: colors.surface },
      title: { color: colors.text, ...Typography.body },
      hint: { color: colors.textSecondary, ...Typography.small },
      name: { color: colors.text, ...Typography.body },
      meta: { color: colors.textSecondary, ...Typography.small },
      action: { borderColor: colors.surfaceBorder },
      actionText: { color: colors.primary, ...Typography.small },
      actionDestructive: { color: colors.error, ...Typography.small },
      addText: { color: colors.primary, ...Typography.body },
      empty: { color: colors.textSecondary, ...Typography.bodyRegular },
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

  const renderMemberRow = (
    member: ChatMemberDto,
    action: { label: string; destructive?: boolean; onPress: () => void },
    meta?: string,
  ) => {
    const name = groupMemberDisplayName(member);
    const pending = groupAdmin.pendingUserID === member.userId;
    return (
      <View key={member.userId} style={s.row}>
        <Avatar size={40} shape="square" name={name} uri={member.avatarUrl ?? undefined} />
        <View style={s.rowText}>
          <Text style={d.name} numberOfLines={1}>
            {name}
          </Text>
          {meta ? (
            <Text style={d.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={[s.rowAction, d.action]}
          onPress={action.onPress}
          disabled={pending}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          {pending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={action.destructive ? d.actionDestructive : d.actionText}>
              {action.label}
            </Text>
          )}
        </Pressable>
      </View>
    );
  };

  const renderAddRow = (label: string, onPress: () => void, testID: string) => (
    <Pressable style={s.actionRow} onPress={onPress} accessibilityRole="button" testID={testID}>
      <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
      <Text style={d.addText}>{label}</Text>
    </Pressable>
  );

  const renderSwitchRow = (params: {
    key: string;
    label: string;
    hint?: string;
    value: boolean;
    onToggle: (next: boolean) => void;
  }) => (
    <View key={params.key} style={s.row}>
      <View style={s.rowText}>
        <Text style={d.name}>{params.label}</Text>
        {params.hint ? (
          <Text style={d.meta}>{params.hint}</Text>
        ) : null}
      </View>
      <ThemedSwitch
        value={params.value}
        onValueChange={settingPending ? undefined : params.onToggle}
      />
    </View>
  );

  const renderPolicyRows = (keys: readonly PolicyKey[]) =>
    keys.map((key, index) => (
      <View key={key}>
        {index > 0 ? <Divider /> : null}
        {renderSwitchRow({
          key,
          label: groupPolicyLabel(key),
          hint: t(`chat.groupPolicyHint.${key}`),
          value: policies?.[key] ?? true,
          onToggle: (next) => handleTogglePolicy(key, next),
        })}
      </View>
    ));

  const renderLinkRow = (label: string, onPress: () => void, testID: string) => (
    <Pressable style={s.row} onPress={onPress} accessibilityRole="button" testID={testID}>
      <View style={s.rowText}>
        <Text style={d.name}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );

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
        <View style={[s.section, d.section]}>
          <View style={s.sectionHeader}>
            <Text style={d.title}>
              {t('chat.groupManagement.settings', { defaultValue: '群设置' })}
            </Text>
          </View>
          {renderSwitchRow({
            key: 'muteAll',
            label: t('chat.muteAll', { defaultValue: '全员禁言' }),
            hint: t('chat.muteAllHint', {
              defaultValue: '开启后仅群主和管理员可以发言',
            }),
            value: muteAll,
            onToggle: handleToggleMuteAll,
          })}
        </View>

        <View style={[s.section, d.section]}>
          <View style={s.sectionHeader}>
            <Text style={d.title}>
              {t('chat.groupManagement.joinMethods', { defaultValue: '进群允许方式' })}
            </Text>
          </View>
          {renderPolicyRows(JOIN_POLICY_KEYS)}
        </View>

        <View style={[s.section, d.section]}>
          <View style={s.sectionHeader}>
            <Text style={d.title}>
              {t('chat.groupManagement.memberPermissions', {
                defaultValue: '成员权限',
              })}
            </Text>
          </View>
          {renderPolicyRows(MEMBER_POLICY_KEYS)}
        </View>

        {isOwner ? (
          <View style={[s.section, d.section]}>
            <View style={s.sectionHeader}>
              <Text style={d.title}>
                {t('chat.groupManagement.ownerSection', { defaultValue: '群主' })}
              </Text>
            </View>
            {/* 独立群聊才有群主转让:圈子群的圈主转让牵涉会员配额与容量,不在这里。 */}
            {isStandaloneGroup
              ? renderLinkRow(
                  t('chat.transferOwner', { defaultValue: '转让群主' }),
                  () => setPickerMode('transfer'),
                  'group-manage-transfer-owner',
                )
              : null}
            {/* 圈子群的成员上限走扩容商品;独立群聊固定 200,没有入口。 */}
            {groupID ? (
              <>
                {isStandaloneGroup ? <Divider /> : null}
                {renderLinkRow(
                  t('chat.raiseMemberLimit', { defaultValue: '提升成员上限' }),
                  handleOpenGroupExpansion,
                  'group-manage-raise-limit',
                )}
              </>
            ) : null}
          </View>
        ) : null}

        {isOwner ? (
          <View style={[s.section, d.section]}>
            <View style={s.sectionHeader}>
              <Text style={d.title}>
                {t('chat.groupManagement.admins', { defaultValue: '群管理员' })}
              </Text>
              <Text style={d.hint}>
                {t('chat.groupManagement.adminsHint', {
                  defaultValue: '管理员可移出普通成员、禁言成员、删除所有人的聊天记录',
                })}
              </Text>
            </View>
            {admins.length === 0 ? (
              <View style={s.emptyRow}>
                <Text style={d.empty}>
                  {t('chat.groupManagement.noAdmins', { defaultValue: '暂无管理员' })}
                </Text>
              </View>
            ) : (
              admins.map((member) =>
                renderMemberRow(member, {
                  label: t('chat.groupManagement.removeAdmin', { defaultValue: '移除' }),
                  onPress: () => groupAdmin.changeRole(member, 'MEMBER'),
                }),
              )
            )}
            <Divider />
            {renderAddRow(
              t('chat.groupManagement.addAdmin', { defaultValue: '添加管理员' }),
              () => setPickerMode('admin'),
              'group-manage-add-admin',
            )}
          </View>
        ) : null}

        <View style={[s.section, d.section]}>
          <View style={s.sectionHeader}>
            <Text style={d.title}>
              {t('chat.groupManagement.silencedMembers', { defaultValue: '禁言成员' })}
            </Text>
          </View>
          {silencedMembers.length === 0 ? (
            <View style={s.emptyRow}>
              <Text style={d.empty}>
                {t('chat.groupManagement.noSilenced', { defaultValue: '暂无成员被禁言' })}
              </Text>
            </View>
          ) : (
            silencedMembers.map((member) =>
              renderMemberRow(
                member,
                {
                  label: t('chat.groupManagement.lift', { defaultValue: '解除' }),
                  onPress: () => groupAdmin.unsilence(member),
                },
                silenceStatusLabel(member),
              ),
            )
          )}
          <Divider />
          {renderAddRow(
            t('chat.groupManagement.addSilence', { defaultValue: '添加禁言' }),
            () => setPickerMode('silence'),
            'group-manage-add-silence',
          )}
        </View>

        <View style={[s.section, d.section]}>
          <View style={s.sectionHeader}>
            <Text style={d.title}>
              {t('chat.groupManagement.removeMembers', { defaultValue: '移出群成员' })}
            </Text>
            <Text style={d.hint}>
              {t('chat.groupManagement.removeMembersHint', {
                defaultValue: '选择成员并移出群聊',
              })}
            </Text>
          </View>
          <Divider />
          {renderAddRow(
            t('chat.groupManagement.pickMember', { defaultValue: '选择成员' }),
            () => setPickerMode('remove'),
            'group-manage-remove-member',
          )}
        </View>
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
        onClose={() => setPickerMode(null)}
      />
      <OptionPickerSheet
        visible={silenceTarget !== null}
        title={t('chat.silencePickDuration', { defaultValue: '选择禁言时长' })}
        options={silenceOptions}
        selectedValue={null}
        onSelect={handleSelectSilenceDuration}
        onClose={() => setSilenceTarget(null)}
      />
    </View>
  );
}
