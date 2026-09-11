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
import { allowsMemberProfiles } from '@/features/chat/utils/group-policy';
import {
  getUserProfileHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { useChatStore } from '@/chat-core/store';

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
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<ChatMemberDto[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  // 圈子群的会话 DTO(取或建的结果):从圈子详情等入口进来时 store 里可能还没有
  // 该会话,策略开关与会话 id 都以它兜底 —— 与 ChatInfoScreen.groupConversation 同款。
  const [circleConversation, setCircleConversation] =
    useState<ChatConversationDto | null>(null);

  // review R2 P1：权限走活体 hook——挂载期间被撤权时订阅立即翻转
  // authorized，下面的目录数据也同步清空，不再是一次性快照。
  const {
    canViewMembers: circleAuthorized,
    selfMember: circleSelfMember,
    resolved: accessResolved,
    revalidate,
  } = useGroupMemberViewAccess({
    enabled: Boolean(groupID && currentUserID),
    groupID,
    currentUserID,
  });
  const authorized = isStandaloneGroup || circleAuthorized;
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
    if (!authorized) {
      setMembers([]);
      setMembersLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setMembersLoading(true);
    // groupID = 圈子 id:先解析(取或建)会话,再拉座位成员表;独立群聊直接按会话 id 取。
    (isStandaloneGroup
      ? fetchChatMembers(standaloneConversationID)
      : createCircleChatConversation(groupID).then((conversation) => {
          if (!cancelled) setCircleConversation(conversation);
          return fetchChatMembers(conversation.id);
        })
    )
      .then((nextMembers) => {
        if (!cancelled) setMembers(nextMembers);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authorized, groupID, isStandaloneGroup, standaloneConversationID]);

  const loading = !accessResolved || membersLoading;

  const trimmedQuery = query.trim().toLowerCase();
  // 搜索也认群昵称:群里认得的是它,只按账号昵称搜会搜不到人。
  const filteredMembers = useMemo(
    () => members.filter((member) => groupMemberMatchesQuery(member, trimmedQuery)),
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

      router.push(
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
