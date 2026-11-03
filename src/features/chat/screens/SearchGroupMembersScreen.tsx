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
import { router, useLocalSearchParams, useSegments } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import {
  groupMemberDisplayName,
  groupMemberMatchesQuery,
} from '@/features/chat/group-member-display';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { createCircleChatConversation, fetchChatMembers } from '@/chat-core/api';
import type { ChatConversationDto, ChatMemberDto } from '@/chat-core/protocol';
import { useGroupMemberViewAccess } from '@/features/chat/hooks/use-group-member-view-access';
import { canViewCircleMembers } from '@/features/chat/group-member-permissions';
import {
  evictGroupInfoCache,
  readGroupInfoCache,
  writeGroupInfoCache,
} from '@/features/chat/group-info-cache';
import { allowsMemberProfiles } from '@/features/chat/utils/group-policy';
import {
  getUserProfileHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { useChatStore } from '@/chat-core/store';
import { useAuthStore } from '@/stores/authStore';

const s = StyleSheet.create({
  container: { flex: 1 },
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
  list: { flex: 1 },
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
});

const Sep = () => <View style={{ height: Spacing.xs }} />;

export default function SearchGroupMembersScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const params = useLocalSearchParams<{
    groupID?: string;
    conversationID?: string;
    groupTitle?: string;
  }>();
  const groupID = typeof params.groupID === 'string' ? params.groupID : '';
  // 独立群聊:没有圈子 id,成员目录直接按会话取,全员可见(服务端座位校验)。
  const standaloneConversationID =
    !groupID && typeof params.conversationID === 'string' ? params.conversationID : '';
  const isStandaloneGroup = Boolean(standaloneConversationID);
  const currentUserID = useChatStore((state) => state.currentUserId);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  // 临时房也从「群成员」行进来(只带会话 id),按会话类型认出它,好和群聊信息页用同一个键。
  const isTempRoom = useChatStore(
    (state) =>
      isStandaloneGroup &&
      state.conversations.find((item) => item.id === standaloneConversationID)
        ?.type === 'TEMP',
  );
  // 与 ChatInfoScreen.groupDataKey 同一套键:两页共用一份成员缓存。
  const groupDataKey = groupID
    ? `circle:${groupID}`
    : `${isTempRoom ? 'temp' : 'standalone'}:${standaloneConversationID}`;
  const [query, setQuery] = useState('');
  // null = 还没有可显示的名单。看过这个群就先用上次的名单画出来,下面照常后台重拉;
  // 只读挂载那一刻 —— 之后键变了(会话晚到 store 认出是临时房)也不清空已显示的内容。
  const [members, setMembers] = useState<ChatMemberDto[] | null>(
    () => readGroupInfoCache(sessionEpoch, groupDataKey)?.members ?? null,
  );
  // 缓存只负责保存数据，不代表当前仍有权查看。每次进入都要等成员接口在本次
  // 会话里确认座位/目录权限；否则被移出群或撤权后会先闪出旧成员姓名和头像。
  const [directoryAccess, setDirectoryAccess] = useState<
    'pending' | 'allowed' | 'denied'
  >('pending');
  // 圈子群的会话 DTO(取或建的结果):从圈子详情等入口进来时 store 里可能还没有
  // 该会话,策略开关与会话 id 都以它兜底 —— 与 ChatInfoScreen.groupConversation 同款。
  const [circleConversation, setCircleConversation] =
    useState<ChatConversationDto | null>(null);
  // 圈子群从详情页进入时,会话 DTO 可能还没进全量会话列表;本地兜底与
  // store 两边都读,让「显示群成员」开关能决定普通成员是否可查目录。
  const membersCanViewRoster = useChatStore((state) => {
    const conversation = state.conversations.find((item) =>
      isStandaloneGroup
        ? item.id === standaloneConversationID
        : Boolean(groupID) && item.circleId === groupID,
    );
    return (
      conversation?.policies?.membersCanViewRoster ??
      circleConversation?.policies?.membersCanViewRoster ??
      null
    );
  });

  // review R2 P1：权限走活体 hook——挂载期间被撤权时订阅立即翻转
  // authorized，下面的目录数据也同步清空，不再是一次性快照。
  // 权限只在本页在前台时兜底轮询,缓存里的角色变了立刻重查(见 useGroupMemberViewAccess)。
  const isFocused = useIsFocused();
  const cachedRole = useChatStore(
    (state) =>
      state.conversations.find((item) =>
        isStandaloneGroup
          ? item.id === standaloneConversationID
          : Boolean(groupID) && item.circleId === groupID,
      )?.myRole ??
      circleConversation?.myRole ??
      null,
  );
  const {
    canViewMembers: liveCircleAuthorized,
    selfMember: circleSelfMember,
    resolved: accessResolved,
    revalidate,
  } = useGroupMemberViewAccess({
    enabled: Boolean(groupID && currentUserID),
    groupID,
    currentUserID,
    membersCanViewRoster,
    active: isFocused,
    roleHint: cachedRole,
  });
  // 活体角色第一次查回来之前(一次 /circle/:id 往返),先按会话 DTO 上的 myRole 判
  // (与 ChatInfoScreen.cachedCircleRole 同款):不然有缓存也得干等这一轮。只影响展示 ——
  // 目录接口服务端鉴权,点开资料前还会 fail-closed 现场重查;活体结果一到就以它为准。
  const circleAuthorized = accessResolved
    ? liveCircleAuthorized
    : canViewCircleMembers(cachedRole) ||
      (cachedRole === 'MEMBER' && membersCanViewRoster === true);
  const authorized = directoryAccess === 'allowed' && (isStandaloneGroup || circleAuthorized);
  // 「成员可查看他人资料」策略:两种群同一判据(群主/管理员豁免,普通成员按开关),
  // 与 ChatInfoScreen / ChatDetailScreen 共用 allowsMemberProfiles —— 这个策略只在
  // 客户端拦,本页对圈子群直接放行就等于没有这道闸。圈子群的角色优先用活体
  // hook(挂载期间被撤职立刻生效),会话 DTO 上的 myRole 兜底。
  const canOpenMemberProfiles = useChatStore((state) => {
    const conversation =
      state.conversations.find((item) =>
        isStandaloneGroup
          ? item.id === standaloneConversationID
          : Boolean(groupID) && item.circleId === groupID,
      ) ?? circleConversation;
    return allowsMemberProfiles({
      role: isStandaloneGroup
        ? conversation?.myRole
        : (circleSelfMember?.role ?? conversation?.myRole),
      policies: conversation?.policies,
    });
  });
  // 打开资料时带给资料页的会话 id(资料页据此按「成员可添加好友」收起入口)。
  const memberConversationID = isStandaloneGroup
    ? standaloneConversationID
    : (circleConversation?.id ?? '');

  useEffect(() => {
    let cancelled = false;
    // 圈子成员角色与「显示群成员」策略是两道闸。即使当前普通成员还
    // 没权限,也必须先取到会话 DTO,否则策略打开后 effect 永远不会重跑。
    // 独立群聊直接按会话 id 取成员;圈子群先取/建会话再按策略决定是否拉目录。
    // 重拉期间不清空已显示的名单(后台刷新),结果回来再整体替换。
    const loadMembers = isStandaloneGroup
      ? fetchChatMembers(standaloneConversationID)
      : createCircleChatConversation(groupID).then((conversation) => {
          if (!cancelled) {
            setCircleConversation(conversation);
            // 让实时 group-policy-changed 能在本页更新这份兜底 DTO。
            useChatStore.getState?.().upsertConversation?.(conversation);
          }
          if (!circleAuthorized && conversation.policies?.membersCanViewRoster !== true) {
            return null;
          }
          return fetchChatMembers(conversation.id);
        });
    loadMembers
      .then((nextMembers) => {
        if (cancelled) return;
        if (nextMembers) {
          writeGroupInfoCache(sessionEpoch, groupDataKey, { members: nextMembers });
          setDirectoryAccess('allowed');
        } else {
          // 没有目录权限:缓存里的名单也不能再给他看(群聊信息页同一份)。
          evictGroupInfoCache(sessionEpoch, groupDataKey);
          setDirectoryAccess('denied');
        }
        setMembers(nextMembers);
      })
      .catch(() => {
        if (cancelled) return;
        // 分不清是被撤权还是网络抖动:按撤权处理,下次进来重新拉。
        evictGroupInfoCache(sessionEpoch, groupDataKey);
        setDirectoryAccess('denied');
        setMembers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [
    circleAuthorized,
    groupDataKey,
    groupID,
    isStandaloneGroup,
    sessionEpoch,
    standaloneConversationID,
  ]);

  // 有权看:有名单(缓存或刚拉到的)就直接画,一份都没有才转圈。无权:活体角色查回来
  // 之前不下结论(可能马上就有权了),先转圈;查回来仍无权才显示「无权查看」。
  const loading = directoryAccess === 'pending';

  const trimmedQuery = query.trim().toLowerCase();
  // 搜索也认群昵称:群里认得的是它,只按账号昵称搜会搜不到人。
  const filteredMembers = useMemo(
    () =>
      (members ?? []).filter((member) => groupMemberMatchesQuery(member, trimmedQuery)),
    [members, trimmedQuery],
  );

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.background,
      },
      surface: {
        backgroundColor: colors.surface,
      },
      input: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
      rowName: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
    }),
    [colors],
  );

  const handleOpenMember = useCallback(
    async (member: ChatMemberDto) => {
      if (!member.userId) {
        return;
      }

      // 「成员可查看他人资料」策略:两种群都拦,看自己的资料永远放行
      // (与 ChatInfoScreen.handleOpenMemberProfile 同口径)。
      if (member.userId !== currentUserID && !canOpenMemberProfiles) {
        Alert.alert(
          t('chat.profilesRestrictedByGroup', {
            defaultValue: '该群未开放查看成员资料',
          }),
        );
        return;
      }

      if (isStandaloneGroup) {
        // 独立群聊:现场重查自己还在不在群里(被踢后列表可能还挂在屏上)。
        try {
          const seated = await fetchChatMembers(standaloneConversationID);
          if (!seated.some((item) => item.userId === currentUserID)) return;
        } catch {
          return;
        }
      } else if (!(await revalidate())) {
        // review R2 P1：打开成员资料前 fail-closed 现场重查——降权后即便
        // 结果列表还挂在屏上，也不能再跳成员资料（hook 状态翻转会顺带清列表）。
        return;
      }

      router.navigate(
        getUserProfileHref(scope, member.userId, member.nickname || undefined, {
          // 资料页据此按本群的「成员可添加好友」决定要不要放加好友入口。
          ...(memberConversationID
            ? { viaConversationID: memberConversationID }
            : {}),
        }),
      );
    },
    [
      canOpenMemberProfiles,
      currentUserID,
      isStandaloneGroup,
      memberConversationID,
      revalidate,
      scope,
      standaloneConversationID,
      t,
    ],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatMemberDto>) => {
      const memberName = groupMemberDisplayName(item);
      return (
        <Pressable
          style={[s.row, d.surface]}
          onPress={() => handleOpenMember(item)}
        >
          <Avatar
            size={40}
            shape="square"
            name={memberName}
            uri={item.avatarUrl ?? undefined}
          />
          <View style={s.rowText}>
            <Text style={d.rowName} numberOfLines={1}>
              {memberName}
            </Text>
          </View>
        </Pressable>
      );
    },
    [d.rowName, d.surface, handleOpenMember],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('chat.searchGroupMembers')} />

      <View style={[s.searchWrap, d.surface]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, d.input]}
          placeholder={t('chat.searchGroupMembersPlaceholder')}
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
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !authorized ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>{t('chat.groupMembersRestricted')}</Text>
        </View>
      ) : filteredMembers.length === 0 ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>
            {trimmedQuery
              ? t('chat.searchGroupMembersNoMatches')
              : t('chat.searchGroupMembersEmpty')}
          </Text>
        </View>
      ) : (
        <FlatList
          style={s.list}
          data={filteredMembers}
          keyExtractor={(item) => item.userId}
          renderItem={renderItem}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={[
            s.listContent,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          {...keyboardDismissOnDragProps}
        />
      )}
    </View>
  );
}
