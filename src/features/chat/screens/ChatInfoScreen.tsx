import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import { Avatar } from '@/components/ui/avatar';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import {
  clearChatConversationHistory,
  createCircleChatConversation,
  fetchChatMembers,
  leaveGroupChatConversation,
  renameGroupChatConversation,
  setChatBurnDuration,
  updateChatConversationPreferences,
} from '@/chat-core/api';
import { formatBurnDuration } from '@/chat-core/message-mappers';
import { ensureDirectConversation } from '@/chat-core/client';
import type { ChatConversationDto, ChatMemberDto } from '@/chat-core/protocol';
import { useChatStore } from '@/chat-core/store';
import { useLocalUnreadStore } from '@/features/messages/store/use-local-unread-store';
import {
  canChangeGroupMemberRole,
  roleLevelFromCircleRole,
} from '@/features/chat/group-member-permissions';
import { useGroupMemberViewAccess } from '@/features/chat/hooks/use-group-member-view-access';
import {
  getChatDetailHref,
  getChatBackgroundHref,
  getChatHistorySearchHubHref,
  getCircleInviteFriendsHref,
  getEditGroupNoticeHref,
  getEditFriendRemarkHref,
  getEditFriendTagsHref,
  getGroupLogHref,
  getGroupMemberSearchHref,
  getRecommendFriendHref,
  getUserProfileHref,
} from '@/features/user/utils/routes';
import {
  addFriendToBlacklist,
  deleteFriendRelationship,
  fetchFriendStatus,
  removeFriendFromBlacklist,
} from '@/services/api/friends';
import { fetchCircleDetail, updateCircle } from '@/services/api/circles';
import { leaveGroup, removeGroupMember, updateGroupMemberRole } from '@/services/api/groups';
import { fetchMyTempChats } from '@/services/api/temp-chat';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { DisplayIcon } from '@/types';
import { reportHandledFailure } from '@/observability/report-failure';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  section: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
  },
  groupContent: {
    paddingBottom: Spacing.xl,
  },
  groupMemberSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  groupMemberGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.lg,
  },
  groupMemberCell: {
    width: '20%',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  groupMemberName: {
    maxWidth: 64,
    textAlign: 'center',
  },
  addMemberBox: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.sm,
  },
  moreMembersButton: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  groupSection: {
    paddingLeft: Spacing.lg,
  },
  groupRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingRight: Spacing.lg,
  },
  groupRowLarge: {
    minHeight: 92,
    alignItems: 'flex-start',
    paddingVertical: Spacing.md,
  },
  groupRowLeft: {
    flex: 1,
    gap: Spacing.xs,
  },
  groupRowRight: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  groupNameText: {
    flexShrink: 1,
    textAlign: 'right',
  },
  groupNoticeText: {
    lineHeight: 20,
  },
  leaveButton: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  renameDialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  renameTitle: {
    ...Typography.h3,
  },
  renameInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    ...Typography.bodyRegular,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  renameButton: {
    minHeight: 44,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
  },
  renameButtonDisabled: {
    opacity: 0.6,
  },
});

const initialActionPending = {
  pin: false,
  mute: false,
};
const GROUP_MEMBER_COLUMNS = 5;
const COLLAPSED_GROUP_MEMBER_ROWS = 4;

type ConversationActionKey = keyof typeof initialActionPending;
type OptimisticConversationState = {
  pinned?: boolean;
  muted?: boolean;
};
type OptimisticConversationStateKey = keyof OptimisticConversationState;

/** 群信息本地态:圈子详情映射(群名=name/群公告=简介 description/人数)。 */
type CircleGroupInfo = {
  name: string;
  notice: string;
  memberCount: number;
};

/** 目录成员的圈子角色 → OpenIM 兼容数字(canChangeGroupMemberRole 按数字比较)。 */
function memberRoleLevel(member: ChatMemberDto): number {
  return roleLevelFromCircleRole(member.role ?? 'MEMBER');
}

type GroupInfoRowProps = {
  label: string;
  value?: string;
  subtitle?: string;
  showArrow?: boolean;
  hasToggle?: boolean;
  toggleValue?: boolean;
  onToggle?: (nextValue: boolean) => void;
  onPress?: () => void;
  destructive?: boolean;
};

function GroupInfoRow({
  label,
  value,
  subtitle,
  showArrow = true,
  hasToggle,
  toggleValue,
  onToggle,
  onPress,
  destructive,
}: GroupInfoRowProps) {
  const { colors } = useTheme();
  const rowLarge = Boolean(subtitle);
  const d = useMemo(
    () => ({
      label: {
        color: destructive ? colors.error : colors.text,
        ...Typography.body,
      },
      value: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
    }),
    [colors, destructive],
  );

  return (
    <Pressable style={[s.groupRow, rowLarge && s.groupRowLarge]} onPress={onPress} disabled={!onPress && !hasToggle}>
      <View style={s.groupRowLeft}>
        <Text style={d.label}>{label}</Text>
        {subtitle ? (
          <Text style={[s.groupNoticeText, d.subtitle]} numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={s.groupRowRight}>
        {value ? (
          <Text style={[s.groupNameText, d.value]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {hasToggle ? (
          <ThemedSwitch
            value={toggleValue}
            onValueChange={onToggle}
          />
        ) : showArrow ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        ) : null}
      </View>
    </Pressable>
  );
}

export default function ChatInfoScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    id?: string;
    sourceID?: string;
    name?: string;
    title?: string;
    conversationID?: string;
    fallbackName?: string;
    conversationType?: 'private' | 'group';
    conversationKind?: 'direct' | 'group' | 'temp' | 'support';
    originScope?: string;
  }>();
  const [blacklist, setBlacklist] = useState(false);
  const [blacklistPending, setBlacklistPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [groupInfo, setGroupInfo] = useState<CircleGroupInfo | null>(null);
  const [groupMembers, setGroupMembers] = useState<ChatMemberDto[]>([]);
  // 圈子群会话 DTO(get-or-create 结果):从圈子详情等入口进来时 store 里可能
  // 还没有该会话,置顶/免打扰的当前值与目标会话 id 都以它兜底。
  const [groupConversation, setGroupConversation] = useState<ChatConversationDto | null>(null);
  const [groupMembersExpanded, setGroupMembersExpanded] = useState(false);
  const [kickPendingUserID, setKickPendingUserID] = useState<string | null>(null);
  const [rolePendingUserID, setRolePendingUserID] = useState<string | null>(null);
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const renameSubmittingRef = useRef(false);
  // friend-scoped 动作（拉黑 / 删除）不走 runConversationAction（那个绑会话）；
  // 用 ref 做 fast double-tap 单飞行守，跟其他屏的 Pattern D 二道闸保持一致。
  const blacklistInFlightRef = useRef(false);
  const deleteInFlightRef = useRef(false);
  const inviteLinkCopyInFlightRef = useRef(false);
  const [actionPending, setActionPending] = useState(initialActionPending);
  const actionPendingRef = useRef(initialActionPending);
  const actionRequestTokenRef = useRef({
    pin: 0,
    mute: 0,
  });
  const currentConversationIDRef = useRef('');
  const [optimisticConversationState, setOptimisticConversationState] = useState<OptimisticConversationState>({});
  const conversations = useChatStore((state) => state.conversations);

  // 自研栈 id 就是后端 UUID(会话列表/联系人/资料页统一),不再需要 OpenIM
  // 去连字符 hex 与 UUID 的互转;单聊按 peer.id、群聊按 circleId 匹配会话。
  const friendId =
    typeof params.id === 'string' ? params.id : typeof params.sourceID === 'string' ? params.sourceID : '';
  const friendName =
    typeof params.name === 'string' ? params.name : typeof params.title === 'string' ? params.title : t('chat.friend');
  const friendFallbackName =
    typeof params.fallbackName === 'string' && params.fallbackName.trim()
      ? params.fallbackName.trim()
      : friendName;
  const routeSourceID = friendId;
  const originScope =
    params.originScope === 'contacts' || params.originScope === 'profile' || params.originScope === 'discover'
      ? params.originScope
      : 'messages';
  const scope = originScope;
  const conversationID = typeof params.conversationID === 'string' ? params.conversationID : '';
  const conversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === conversationID) ??
      conversations.find(
        (conversation) => conversation.peer?.id === routeSourceID || conversation.circleId === routeSourceID,
      ) ??
      null,
    [conversationID, conversations, routeSourceID],
  );
  const isTempConversation =
    params.conversationKind === 'temp' || conversation?.type === 'TEMP';
  // 独立群聊(微信群):GROUP 会话但不挂圈子。它没有圈子详情/角色/公告,
  // 成员与改名/退群走 /chat/conversations/:id/* 专属端点。
  const isStandaloneGroup =
    !isTempConversation &&
    conversation?.type === 'GROUP' &&
    conversation.circleId == null;
  const isGroupConversation =
    isTempConversation ||
    params.conversationType === 'group' ||
    conversation?.type === 'GROUP' ||
    Boolean(conversation?.circleId);
  // 自研栈下「圈子群=圈子」:群会话的 circleId 即圈子 id,路由 sourceID 也是圈子 id。
  // TEMP 也是多人会话,但不是圈子；绝不能把 tmp... sourceID 当 UUID 请求 /circle/:id。
  // 独立群聊同理:它的 sourceID 是会话 id,也绝不能当圈子 id 用。
  const groupID = isGroupConversation && !isTempConversation && !isStandaloneGroup
    ? conversation?.circleId || routeSourceID
    : '';
  const groupTitle =
    groupInfo?.name ||
    conversation?.circle?.name ||
    conversation?.name?.trim() ||
    conversation?.tempChat?.title ||
    friendName ||
    t('chat.groupChat');
  const groupNotice = groupInfo?.notice?.trim() ?? '';
  const memberCount = groupInfo?.memberCount ?? groupMembers.length;
  const currentUserID = useChatStore((state) => state.currentUserId);
  // review R2 P1：自己的群成员身份走活体 hook——群主在本页存活期间撤掉管理员
  // 时，订阅推送立即收紧目录/搜索/管理入口，不再等重新聚焦。
  const {
    selfMember: currentGroupMember,
    canViewMembers: canViewCircleMemberDirectory,
    revalidate: revalidateMemberAccess,
  } = useGroupMemberViewAccess({
    enabled: Boolean(isGroupConversation && groupID && currentUserID),
    groupID,
    currentUserID,
  });
  // 临时房不是圈子,没有圈子角色可判——目录权限由后端的座位校验兜底
  // (GET /chat/conversations/:id/members),与 ChatDetailScreen 同口径。
  // 不放开的话本页会渲染群布局却永远 0 成员、没有成员目录。
  const canViewMemberDirectory =
    isTempConversation || isStandaloneGroup || canViewCircleMemberDirectory;
  const currentRole = currentGroupMember?.roleLevel ?? null;
  const isOwner = currentGroupMember?.role === 'OWNER';
  const isAdmin = currentGroupMember?.role === 'ADMIN';
  const canManageGroup = isOwner || isAdmin;
  const collapsedGroupMemberLimit = GROUP_MEMBER_COLUMNS * COLLAPSED_GROUP_MEMBER_ROWS - (canManageGroup ? 1 : 0);
  const visibleGroupMembers = useMemo(
    () => (groupMembersExpanded ? groupMembers : groupMembers.slice(0, collapsedGroupMemberLimit)),
    [collapsedGroupMemberLimit, groupMembers, groupMembersExpanded],
  );
  // 会话 dto:store 优先(偏好更新会 upsert 回写、保持活体),群聊兜底到本页
  // get-or-create 的结果。
  const activeConversation = conversation ?? groupConversation;
  const resolvedConversationID = activeConversation?.id ?? '';
  currentConversationIDRef.current = resolvedConversationID;
  const basePinned = activeConversation?.pinned ?? false;
  const baseMuted = activeConversation?.muted ?? false;
  const displayIcons = useMemo(() => [] as DisplayIcon[], []);
  const backHref = useMemo(() => {
    if (originScope === 'messages') {
      if (isGroupConversation) {
        return getChatDetailHref(
          originScope,
          groupID || routeSourceID,
          groupTitle,
          activeConversation?.circle?.avatarUrl ?? undefined,
          resolvedConversationID || conversationID,
          undefined,
          'group',
        );
      }

      return getChatDetailHref(
        originScope,
        routeSourceID,
        friendName,
        undefined,
        resolvedConversationID || conversationID,
      );
    }

    return getUserProfileHref(originScope, friendId, friendName);
  }, [
    conversationID,
    activeConversation?.circle?.avatarUrl,
    friendId,
    friendName,
    groupID,
    groupTitle,
    isGroupConversation,
    originScope,
    resolvedConversationID,
    routeSourceID,
  ]);
  const pinned = optimisticConversationState.pinned ?? basePinned;
  const muted = optimisticConversationState.muted ?? baseMuted;
  const hasOptimisticConversationState =
    optimisticConversationState.pinned !== undefined ||
    optimisticConversationState.muted !== undefined;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      if (!friendId || isGroupConversation) {
        setBlacklist(false);
        return () => {
          cancelled = true;
        };
      }

      fetchFriendStatus(friendId)
        .then((status) => {
          if (!cancelled) {
            setBlacklist(status.status === 'BLOCKED');
          }
        })
        .catch(() => {
          if (!cancelled) {
            setBlacklist(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [friendId, isGroupConversation]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      // 临时房走会话自己的成员端点:没有圈子详情可查(没有 name/description/
      // memberCount),会话 id 也已经在手上,不需要 get-or-create。
      if (isTempConversation) {
        setGroupInfo(null);
        setGroupConversation(null);
        // store 还没灌进会话时(从临时聊天列表直接进来)只有路由参数,
        // 与本页其它读路径同口径回落。
        const tempConversationID = resolvedConversationID || conversationID;
        if (!tempConversationID) {
          setGroupMembers([]);
          return () => {
            cancelled = true;
          };
        }
        fetchChatMembers(tempConversationID)
          .then((members) => {
            if (!cancelled) setGroupMembers(members);
          })
          .catch(() => {
            if (!cancelled) setGroupMembers([]);
          });
        return () => {
          cancelled = true;
        };
      }

      if (isStandaloneGroup && conversationID) {
        // 独立群聊:没有圈子详情可拉,群名在会话 DTO 上;成员目录直接按会话 id 取
        // (服务端座位校验,全员可见)。
        setGroupInfo(null);
        fetchChatMembers(conversationID)
          .then((members) => {
            if (!cancelled) setGroupMembers(members);
          })
          .catch(() => {
            if (!cancelled) setGroupMembers([]);
          });
        return () => {
          cancelled = true;
        };
      }

      if (!isGroupConversation || !groupID) {
        setGroupInfo(null);
        setGroupMembers([]);
        setGroupConversation(null);
        return () => {
          cancelled = true;
        };
      }

      setGroupMembers([]);

      // 群信息=圈子详情:群名=name,群公告=圈子简介 description,人数=memberCount。
      fetchCircleDetail(groupID)
        .then((detail) => {
          if (!cancelled) {
            setGroupInfo({
              name: detail.name,
              notice: detail.description,
              memberCount: detail.memberCount,
            });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setGroupInfo(null);
          }
        });

      // 先解析(取或建)圈子群会话——置顶/免打扰作用于该会话 id;成员目录只有
      // 确认了目录权限才拉取,canViewMemberDirectory 由活体 hook 驱动——挂载中
      // 被撤权时它翻 false,本回调重跑并把目录清空。
      const loadMemberDirectory = async () => {
        try {
          const conversationDto = await createCircleChatConversation(groupID);
          if (cancelled) return;
          setGroupConversation(conversationDto);
          if (!canViewMemberDirectory) {
            setGroupMembers([]);
            return;
          }
          // 成员头像/昵称以 fetchChatMembers 返回为准(后端即事实源,无需再
          // 逐个刷 profile)。
          const members = await fetchChatMembers(conversationDto.id);
          if (!cancelled) {
            setGroupMembers(members);
          }
        } catch {
          if (!cancelled) {
            setGroupMembers([]);
          }
        }
      };
      void loadMemberDirectory();

      return () => {
        cancelled = true;
      };
    }, [
      canViewMemberDirectory,
      conversationID,
      groupID,
      isGroupConversation,
      isStandaloneGroup,
      isTempConversation,
      resolvedConversationID,
    ]),
  );

  useEffect(() => {
    actionPendingRef.current = initialActionPending;
    setActionPending(initialActionPending);
    setOptimisticConversationState({});
  }, [resolvedConversationID]);

  useEffect(() => {
    if (!hasOptimisticConversationState) {
      return;
    }

    setOptimisticConversationState((current) => {
      const nextState = { ...current };
      let changed = false;

      if (current.pinned !== undefined && current.pinned === basePinned) {
        delete nextState.pinned;
        changed = true;
      }

      if (current.muted !== undefined && current.muted === baseMuted) {
        delete nextState.muted;
        changed = true;
      }

      return changed ? nextState : current;
    });
  }, [baseMuted, basePinned, hasOptimisticConversationState]);

  const openActionError = useCallback(
    (error: unknown) => {
      reportHandledFailure('chatInfo', 'action', error);
      // getApiErrorMessage only surfaces whitelisted localized copy (never the
      // raw backend text), falling back to the generic message otherwise.
      Alert.alert(
        t('common.errorOccurred'),
        getApiErrorMessage(error, t('common.networkError')),
      );
    },
    [t],
  );

  const setConversationActionPending = useCallback((action: ConversationActionKey, nextPending: boolean) => {
    actionPendingRef.current = {
      ...actionPendingRef.current,
      [action]: nextPending,
    };
    setActionPending(actionPendingRef.current);
  }, []);

  const startActionRequest = useCallback((action: ConversationActionKey) => {
    const nextToken = actionRequestTokenRef.current[action] + 1;
    actionRequestTokenRef.current = {
      ...actionRequestTokenRef.current,
      [action]: nextToken,
    };
    return nextToken;
  }, []);

  const isActionConversationCurrent = useCallback(
    (conversationID: string) => currentConversationIDRef.current === conversationID,
    [],
  );

  const isLatestActionRequest = useCallback(
    (action: ConversationActionKey, requestToken: number) => actionRequestTokenRef.current[action] === requestToken,
    [],
  );

  const dropOptimisticConversationStateKey = useCallback((key: OptimisticConversationStateKey) => {
    setOptimisticConversationState((current) => {
      if (current[key] === undefined) {
        return current;
      }

      const nextState = { ...current };
      delete nextState[key];
      return nextState;
    });
  }, []);

  const runConversationAction = useCallback(
    async (action: ConversationActionKey, task: () => Promise<void>, onStart?: () => void, rollback?: () => void) => {
      if (!resolvedConversationID || actionPendingRef.current[action]) {
        return;
      }

      const actionConversationID = resolvedConversationID;
      const actionRequestToken = startActionRequest(action);
      setConversationActionPending(action, true);
      onStart?.();

      try {
        await task();
      } catch (error) {
        if (isActionConversationCurrent(actionConversationID) && isLatestActionRequest(action, actionRequestToken)) {
          rollback?.();
          openActionError(error);
        }
      } finally {
        if (isActionConversationCurrent(actionConversationID) && isLatestActionRequest(action, actionRequestToken)) {
          setConversationActionPending(action, false);
        }
      }
    },
    [
      isActionConversationCurrent,
      isLatestActionRequest,
      openActionError,
      resolvedConversationID,
      startActionRequest,
      setConversationActionPending,
    ],
  );

  const handleOpenRemark = useCallback(() => {
    if (!friendId) {
      return;
    }

    router.push(getEditFriendRemarkHref(scope, friendId, friendName, friendFallbackName));
  }, [friendFallbackName, friendId, friendName, scope]);

  const handleOpenTags = useCallback(() => {
    if (!friendId) {
      return;
    }

    router.push(getEditFriendTagsHref(scope, friendId, friendName));
  }, [friendId, friendName, scope]);

  const handleOpenChatBackground = useCallback(() => {
    if (!resolvedConversationID) {
      return;
    }

    router.push(getChatBackgroundHref(resolvedConversationID, routeSourceID, friendName));
  }, [friendName, resolvedConversationID, routeSourceID]);

  const handleOpenRecommendFriend = useCallback(() => {
    if (!resolvedConversationID || !friendId) {
      return;
    }

    router.push(getRecommendFriendHref(resolvedConversationID, friendId, friendName));
  }, [friendId, friendName, resolvedConversationID]);

  const resolveConversationIDForNavigation = useCallback(async () => {
    const existingConversationID = resolvedConversationID.trim();

    if (existingConversationID) {
      return existingConversationID;
    }

    if (!friendId) {
      return '';
    }

    try {
      const conversation = await ensureDirectConversation(friendId);
      return conversation.conversationID;
    } catch (error) {
      openActionError(error);
      return '';
    }
  }, [friendId, openActionError, resolvedConversationID]);

  // 群二维码:独立群发 GROUP 码(会话 id);圈子群发 CIRCLE 码(圈子 id)——
  // 圈子群的准入由圈子管理,签发权限与加入语义都在服务端按圈子策略把关。
  const handleOpenGroupQr = useCallback(() => {
    if (isStandaloneGroup) {
      const id = resolvedConversationID || conversationID;
      if (!id) return;
      router.push({
        pathname: '/qr-code',
        params: { type: 'group', id, name: groupTitle },
      });
      return;
    }
    if (!groupID) return;
    router.push({
      pathname: '/qr-code',
      params: { type: 'circle', id: groupID, name: groupTitle },
    });
  }, [conversationID, groupID, groupTitle, isStandaloneGroup, resolvedConversationID]);

  const handleOpenSearchHistory = useCallback(() => {
    void (async () => {
      const nextConversationID = await resolveConversationIDForNavigation();

      if (!nextConversationID) {
        return;
      }

      router.push(getChatHistorySearchHubHref(nextConversationID, routeSourceID, friendName));
    })();
  }, [friendName, resolveConversationIDForNavigation, routeSourceID]);

  const handleCopyTempChatInviteLink = useCallback(async () => {
    if (!isTempConversation || !resolvedConversationID || inviteLinkCopyInFlightRef.current) {
      return;
    }

    inviteLinkCopyInFlightRef.current = true;
    try {
      const rooms = await fetchMyTempChats();
      const tempChatID = conversation?.tempChat?.id;
      const room = rooms.find(
        (candidate) =>
          (tempChatID ? candidate.id === tempChatID : false) ||
          candidate.conversationId === resolvedConversationID,
      );
      if (!room?.isActive || !room.shareUrl) {
        throw new Error('Temp chat invite link unavailable');
      }

      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(room.shareUrl);
      Alert.alert(t('tempChats.linkCopied'));
    } catch {
      Alert.alert(t('tempChats.copyFailed'));
    } finally {
      inviteLinkCopyInFlightRef.current = false;
    }
  }, [conversation?.tempChat?.id, isTempConversation, resolvedConversationID, t]);

  const handleOpenSearchGroupMembers = useCallback(() => {
    if (!groupID || !canViewMemberDirectory) {
      return;
    }

    router.push(
      getGroupMemberSearchHref(scope, {
        groupID,
        groupTitle,
      }),
    );
  }, [canViewMemberDirectory, groupID, groupTitle, scope]);

  const promptForText = useCallback(
    (title: string, defaultValue: string, onSubmit: (value: string) => void, options?: { multiline?: boolean }) => {
      if (typeof Alert.prompt !== 'function') {
        Alert.alert(title, t('chat.promptUnsupported'));
        return;
      }

      Alert.prompt(
        title,
        undefined,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.save'),
            onPress: (value: string | undefined) => onSubmit(value ?? ''),
          },
        ],
        options?.multiline ? 'plain-text' : 'plain-text',
        defaultValue,
      );
    },
    [t],
  );

  const handleEditGroupName = useCallback(() => {
    if (!groupID && !isStandaloneGroup) {
      return;
    }

    if (isStandaloneGroup) {
      setRenameDraft(groupTitle);
      setRenameDialogVisible(true);
      return;
    }

    promptForText(t('chat.groupName'), groupTitle, (value) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === groupTitle) {
        return;
      }

      // 圈子群:群名即圈子名,改群名 = 改圈子 name。
      updateCircle(groupID, { name: trimmed })
        .then(() => {
          setGroupInfo((current) => (current ? { ...current, name: trimmed } : current));
        })
        .catch(openActionError);
    });
  }, [groupID, groupTitle, isStandaloneGroup, openActionError, promptForText, t]);

  const handleSubmitStandaloneGroupRename = useCallback(async () => {
    if (renameSubmittingRef.current || !conversationID) return;
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === groupTitle) {
      setRenameDialogVisible(false);
      return;
    }

    renameSubmittingRef.current = true;
    setRenameSubmitting(true);
    try {
      const dto = await renameGroupChatConversation(conversationID, trimmed);
      useChatStore.getState().upsertConversation(dto);
      setRenameDialogVisible(false);
    } catch (error) {
      openActionError(error);
    } finally {
      renameSubmittingRef.current = false;
      setRenameSubmitting(false);
    }
  }, [conversationID, groupTitle, openActionError, renameDraft]);

  const handleEditGroupNotice = useCallback(() => {
    if (!groupID) {
      return;
    }

    router.push(
      getEditGroupNoticeHref(scope, {
        groupID,
        groupTitle,
        notice: groupNotice,
      }),
    );
  }, [groupID, groupNotice, groupTitle, scope]);

  const handleOpenInviteGroupMembers = useCallback(() => {
    if (isStandaloneGroup) {
      // 独立群聊:好友多选直接进群(无担保流程)。
      router.push({
        pathname:
          scope === 'discover'
            ? '/(tabs)/discover/invite-group-members'
            : '/(tabs)/messages/invite-group-members',
        params: { conversationID, title: groupTitle },
      });
      return;
    }
    if (!groupID) {
      return;
    }

    // 圈子群:「加群成员」=邀请好友进圈(担保邀请流程);邀请页只挂在
    // messages/discover 两个栈,其余 scope 统一走 messages 栈。
    router.push(
      getCircleInviteFriendsHref(scope === 'discover' ? 'discover' : 'messages', groupID, groupTitle),
    );
  }, [conversationID, groupID, groupTitle, isStandaloneGroup, scope]);

  const handleOpenMemberProfile = useCallback(
    async (member: ChatMemberDto) => {
      if (!member.userId) {
        return;
      }

      // 打开成员资料前 fail-closed 现场重查，网格还没来得及收起时也拦得住
      // 降权或已离群后的点击。独立群/TEMP 没有 circle membership，改查当前会话成员。
      if (isStandaloneGroup || isTempConversation) {
        const memberConversationID = resolvedConversationID || conversationID;
        if (!memberConversationID) {
          return;
        }
        try {
          const members = await fetchChatMembers(memberConversationID);
          if (!members.some((item) => item.userId === member.userId)) {
            return;
          }
        } catch {
          return;
        }
      } else if (!(await revalidateMemberAccess())) {
        return;
      }

      router.push(getUserProfileHref(scope, member.userId, member.nickname || undefined));
    },
    [conversationID, isStandaloneGroup, isTempConversation, resolvedConversationID, revalidateMemberAccess, scope],
  );

  const handleChangeMemberRole = useCallback(
    (member: ChatMemberDto) => {
      if (!groupID || rolePendingUserID || !canChangeGroupMemberRole(currentRole, memberRoleLevel(member))) {
        return;
      }

      const nextRole = member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
      setRolePendingUserID(member.userId);
      // review R3：action sheet 打开到点确认之间可能已失去群主身份，PATCH 前
      // 现场重查自己的圈子角色（不吃创建 alert 时捕获的 currentRole），fail-closed。
      void (async () => {
        try {
          const freshDetail = await fetchCircleDetail(groupID);
          const freshRole = freshDetail.myStatus === 'ACTIVE' ? freshDetail.myRole : null;
          const freshSelfRoleLevel = freshRole ? roleLevelFromCircleRole(freshRole) : null;
          if (!canChangeGroupMemberRole(freshSelfRoleLevel, memberRoleLevel(member))) {
            Alert.alert(t('chat.groupMembersRestricted'));
            return;
          }
          await updateGroupMemberRole(groupID, member.userId, nextRole);
          setGroupMembers((members) =>
            members.map((item) =>
              item.userId === member.userId ? { ...item, role: nextRole } : item,
            ),
          );
          Alert.alert(
            t('common.done'),
            nextRole === 'ADMIN'
              ? t('chat.adminGranted', { name: member.nickname || member.userId })
              : t('chat.adminRevoked', { name: member.nickname || member.userId }),
          );
        } catch (error) {
          openActionError(error);
        } finally {
          setRolePendingUserID(null);
        }
      })();
    },
    [currentRole, groupID, openActionError, rolePendingUserID, t],
  );

  const handleKickMember = useCallback(
    (member: ChatMemberDto) => {
      if (!groupID || !canManageGroup || member.userId === currentUserID) {
        return;
      }

      // 群主可以踢任何人；管理员只能踢普通成员。
      if (!isOwner && (member.role ?? 'MEMBER') !== 'MEMBER') {
        return;
      }

      const memberName = member.nickname || member.userId;

      Alert.alert(t('chat.removeMember'), t('chat.removeMemberConfirm', { name: memberName }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('chat.remove'),
          style: 'destructive',
          onPress: () => {
            setKickPendingUserID(member.userId);
            removeGroupMember(groupID, member.userId)
              .then(() => {
                setGroupMembers((members) => members.filter((m) => m.userId !== member.userId));
                setGroupInfo((current) =>
                  current && current.memberCount > 0 ? { ...current, memberCount: current.memberCount - 1 } : current,
                );
                Alert.alert(t('chat.deleted'), t('chat.memberRemoved', { name: memberName }));
              })
              .catch(openActionError)
              .finally(() => setKickPendingUserID(null));
          },
        },
      ]);
    },
    [canManageGroup, currentUserID, groupID, isOwner, openActionError, t],
  );

  const handleMemberActions = useCallback(
    (member: ChatMemberDto) => {
      const canChangeRole = canChangeGroupMemberRole(currentRole, memberRoleLevel(member));
      const canKick =
        canManageGroup &&
        member.userId !== currentUserID &&
        (isOwner || (member.role ?? 'MEMBER') === 'MEMBER');
      if (!canChangeRole && !canKick) return;

      const actions: NonNullable<Parameters<typeof Alert.alert>[2]> = [];
      if (canChangeRole) {
        actions.push({
          text:
            member.role === 'ADMIN'
              ? t('chat.revokeGroupAdmin')
              : t('chat.grantGroupAdmin'),
          onPress: () => handleChangeMemberRole(member),
        });
      }
      if (canKick) {
        actions.push({
          text: t('chat.removeMember'),
          style: 'destructive',
          onPress: () => handleKickMember(member),
        });
      }
      actions.push({ text: t('common.cancel'), style: 'cancel' });
      Alert.alert(member.nickname || member.userId, undefined, actions);
    },
    [canManageGroup, currentRole, currentUserID, handleChangeMemberRole, handleKickMember, isOwner, t],
  );

  const handleOpenGroupReport = useCallback(() => {
    if (!groupID) {
      return;
    }

    router.push({
      pathname: '/(tabs)/messages/report-friend',
      params: {
        targetType: 'group',
        groupID,
        groupName: groupTitle,
      },
    });
  }, [groupID, groupTitle]);

  const handleLeaveGroup = useCallback(() => {
    if (!groupID && !isStandaloneGroup) {
      return;
    }

    Alert.alert(t('chat.leaveGroup'), t('chat.leaveGroupWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.leave'),
        style: 'destructive',
        onPress: () => {
          if (isStandaloneGroup) {
            // 独立群聊:退会话本身;群主退群服务端自动转移。
            leaveGroupChatConversation(conversationID)
              .then(() => {
                useChatStore.getState().removeConversation(conversationID);
                router.replace('/(tabs)/messages');
              })
              .catch(openActionError);
            return;
          }
          // 圈子群:退群=退圈,后端座位同步会把群会话一并出清。
          leaveGroup(groupID)
            .then(() => router.replace('/(tabs)/messages'))
            .catch(openActionError);
        },
      },
    ]);
  }, [conversationID, groupID, isStandaloneGroup, openActionError, t]);

  const handleToggleBlacklist = useCallback(
    (nextValue: boolean) => {
      if (!friendId || blacklistPending || blacklistInFlightRef.current) {
        return;
      }

      blacklistInFlightRef.current = true;
      setBlacklistPending(true);
      const previousValue = blacklist;
      setBlacklist(nextValue);

      const request = nextValue ? addFriendToBlacklist(friendId) : removeFriendFromBlacklist(friendId);

      void request
        .catch((error: unknown) => {
          setBlacklist(previousValue);
          openActionError(error);
        })
        .finally(() => {
          blacklistInFlightRef.current = false;
          setBlacklistPending(false);
        });
    },
    [blacklist, blacklistPending, friendId, openActionError],
  );

  const handleConfirmDeleteContact = useCallback(() => {
    if (!friendId || deletePending || deleteInFlightRef.current) {
      return;
    }

    Alert.alert(t('chat.deleteFriend'), t('chat.deleteFriendWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          // 二次守：Alert 弹出期间 state 可能被外部刷新，进 onPress 再检一次。
          if (deleteInFlightRef.current) return;
          deleteInFlightRef.current = true;
          setDeletePending(true);
          void deleteFriendRelationship(friendId)
            .then(() => {
              Alert.alert(t('chat.deleted'), t('chat.friendDeleted'), [
                {
                  text: t('common.ok'),
                  onPress: () => router.back(),
                },
              ]);
            })
            .catch((error: unknown) => {
              openActionError(error);
            })
            .finally(() => {
              deleteInFlightRef.current = false;
              setDeletePending(false);
            });
        },
      },
    ]);
  }, [deletePending, friendId, openActionError, t]);

  const handleTogglePinned = useCallback(
    (nextPinned: boolean) => {
      if (!resolvedConversationID || actionPending.pin) {
        return;
      }

      void runConversationAction(
        'pin',
        async () => {
          await updateChatConversationPreferences(resolvedConversationID, { pinned: nextPinned });
        },
        () =>
          setOptimisticConversationState((current) => ({
            ...current,
            pinned: nextPinned,
          })),
        () => dropOptimisticConversationStateKey('pinned'),
      );
    },
    [actionPending.pin, dropOptimisticConversationStateKey, resolvedConversationID, runConversationAction],
  );

  const handleToggleMuted = useCallback(
    (nextMuted: boolean) => {
      if (!resolvedConversationID || actionPending.mute) {
        return;
      }

      void runConversationAction(
        'mute',
        async () => {
          await updateChatConversationPreferences(resolvedConversationID, { muted: nextMuted });
          if (nextMuted) {
            Alert.alert(t('chat.messagesThatNotify'), t('chat.messagesThatNotifyHint'));
          }
        },
        () =>
          setOptimisticConversationState((current) => ({
            ...current,
            muted: nextMuted,
          })),
        () => dropOptimisticConversationStateKey('muted'),
      );
    },
    [actionPending.mute, dropOptimisticConversationStateKey, resolvedConversationID, runConversationAction, t],
  );

  // S-01 会话级阅后即焚:当前档位跟随会话 DTO(REST 回执会经 store 更新)。
  const burnDurationSec = activeConversation?.burnDurationSec ?? null;

  // 六个档位 + 取消 = 7 个按钮,而 Android 的 Alert 最多渲染 3 个 —— 用
  // Alert 的话安卓用户根本够不到后面几档。改用应用内的选项面板(两端一致)。
  const [burnPickerVisible, setBurnPickerVisible] = useState(false);
  const [burnPending, setBurnPending] = useState(false);
  const burnRequestRef = useRef(0);
  const burnOptions = useMemo(
    () =>
      [0, 30, 300, 3600, 86400, 604800].map((seconds) => ({
        value: seconds,
        label: seconds === 0 ? t('chat.burnOff') : formatBurnDuration(seconds),
      })),
    [t],
  );

  const handleOpenBurnOptions = useCallback(() => {
    if (!resolvedConversationID || burnPending) return;
    setBurnPickerVisible(true);
  }, [burnPending, resolvedConversationID]);

  const handleSelectBurnDuration = useCallback(
    (seconds: number) => {
      if (!resolvedConversationID) return;
      setBurnPickerVisible(false);
      // 与相邻的置顶/免打扰一样上一道在途闸,并给请求编号:连点两个档位时
      // 先发的那个若后落地,会把用户最后的选择覆盖掉,store 还跟着它走。
      const request = burnRequestRef.current + 1;
      burnRequestRef.current = request;
      setBurnPending(true);
      void setChatBurnDuration(resolvedConversationID, seconds)
        .catch((error: unknown) => {
          if (burnRequestRef.current !== request) return;
          Alert.alert(
            t('chat.burnAfterReading'),
            getApiErrorMessage(error, t('common.networkError')),
          );
        })
        .finally(() => {
          if (burnRequestRef.current === request) setBurnPending(false);
        });
    },
    [resolvedConversationID, t],
  );

  // G-14 清空聊天记录:私聊推进双方水位,群聊只推进本人水位。
  const handleClearHistory = useCallback(() => {
    if (!resolvedConversationID) return;

    const clearHistory = (forEveryone: boolean) => {
      void clearChatConversationHistory(resolvedConversationID, {
        forEveryone,
      })
        .then(() => {
          useLocalUnreadStore.getState().clearUnread(resolvedConversationID);
          Alert.alert(
            forEveryone
              ? t('chat.clearHistoryDoneDirect', {
                  defaultValue: '双方聊天记录已删除',
                })
              : t('chat.clearHistoryDone'),
          );
        })
        .catch((error: unknown) => {
          Alert.alert(
            t('chat.clearHistory'),
            getApiErrorMessage(error, t('common.networkError')),
          );
        });
    };

    if (isGroupConversation) {
      Alert.alert(
        t('chat.clearHistory'),
        t('chat.clearHistoryConfirm'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('chat.clearHistoryForMe', { defaultValue: '仅删除我的记录' }),
            onPress: () => clearHistory(false),
          },
          {
            text: t('chat.clearHistoryForEveryone', { defaultValue: '删除所有人的记录' }),
            style: 'destructive',
            onPress: () => clearHistory(true),
          },
        ],
      );
      return;
    }

    Alert.alert(
      t('chat.clearHistory'),
      t('chat.clearHistoryConfirmDirect', {
        defaultValue:
          '确定清空聊天记录吗？对方的记录也会同时删除，此操作无法撤销。',
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('chat.clearHistory'),
          style: 'destructive',
          onPress: () => clearHistory(true),
        },
      ],
    );
  }, [isGroupConversation, resolvedConversationID, t]);

  const handleOpenGroupLog = useCallback(() => {
    if (!resolvedConversationID) return;
    router.push(
      getGroupLogHref(scope, {
        conversationID: resolvedConversationID,
        title: groupTitle,
      }),
    );
  }, [groupTitle, resolvedConversationID, scope]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      section: {
        backgroundColor: colors.surface,
      },
      groupDivider: {
        backgroundColor: colors.background,
      },
      groupMemberName: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      memberRoleBadge: {
        color: colors.primary,
        ...Typography.caption,
      },
      addMemberBox: {
        borderColor: colors.surfaceBorder,
      },
      moreMembersText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      groupSection: {
        backgroundColor: colors.surface,
      },
      leaveText: {
        color: colors.error,
        ...Typography.body,
      },
      renameBackdrop: {
        backgroundColor: colors.overlay,
      },
      renameDialog: {
        backgroundColor: colors.surface,
      },
      renameTitle: {
        color: colors.text,
      },
      renameInput: {
        color: colors.text,
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      renameCancelButton: {
        backgroundColor: colors.background,
      },
      renameSaveButton: {
        backgroundColor: colors.primary,
      },
      renameCancelText: {
        color: colors.text,
      },
      renameSaveText: {
        color: colors.white,
      },
    }),
    [colors],
  );

  if (isGroupConversation) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader
          title={t('chat.groupInfoWithCount', { count: memberCount })}
          fallbackHref={backHref}
          rightIcon={
            canViewMemberDirectory && groupID ? 'search-outline' : undefined
          }
          onRightPress={
            canViewMemberDirectory && groupID
              ? handleOpenSearchGroupMembers
              : undefined
          }
        />
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.groupContent, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          {canViewMemberDirectory ? (
            <View style={s.groupMemberSection}>
            <View style={s.groupMemberGrid}>
              {visibleGroupMembers.map((member) => {
                const memberName = member.nickname || member.userId;
                const roleBadge =
                  member.role === 'OWNER'
                    ? t('chat.groupOwner')
                    : member.role === 'ADMIN'
                      ? t('chat.groupAdmin')
                      : null;
                const hasMemberActions =
                  canChangeGroupMemberRole(currentRole, memberRoleLevel(member)) ||
                  (canManageGroup &&
                    member.userId !== currentUserID &&
                    (isOwner || (member.role ?? 'MEMBER') === 'MEMBER'));

                return (
                  <Pressable
                    key={member.userId}
                    style={s.groupMemberCell}
                    onPress={() => handleOpenMemberProfile(member)}
                    onLongPress={hasMemberActions ? () => handleMemberActions(member) : undefined}
                    disabled={kickPendingUserID === member.userId || rolePendingUserID === member.userId}
                  >
                    <Avatar size={56} shape="square" name={memberName} uri={member.avatarUrl ?? undefined} />
                    <Text style={[s.groupMemberName, d.groupMemberName]} numberOfLines={1}>
                      {memberName}
                    </Text>
                    {roleBadge ? (
                      <Text style={d.memberRoleBadge} numberOfLines={1}>
                        {roleBadge}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
              {canManageGroup || isStandaloneGroup ? (
                <Pressable style={s.groupMemberCell} onPress={handleOpenInviteGroupMembers}>
                  <View style={[s.addMemberBox, d.addMemberBox, { width: 56, height: 56 }]}>
                    <Ionicons name="add" size={30} color={colors.textSecondary} />
                  </View>
                </Pressable>
              ) : null}
            </View>
            {groupMembers.length > collapsedGroupMemberLimit ? (
              <Pressable style={s.moreMembersButton} onPress={() => setGroupMembersExpanded((current) => !current)}>
                <Text style={d.moreMembersText}>{t('chat.moreGroupMembers')}</Text>
                <Ionicons
                  name={groupMembersExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textSecondary}
                />
              </Pressable>
            ) : null}
            </View>
          ) : null}

          <View style={[s.groupSection, d.groupSection]}>
            <GroupInfoRow
              label={t('chat.groupName')}
              value={groupTitle}
              onPress={
                canManageGroup || isStandaloneGroup
                  ? handleEditGroupName
                  : undefined
              }
              showArrow={canManageGroup || isStandaloneGroup}
            />
            {isStandaloneGroup ? null : (
              <>
                <Divider />
                <GroupInfoRow
                  label={t('chat.groupNotice')}
                  subtitle={groupNotice || t('chat.noGroupNotice')}
                  onPress={canManageGroup ? handleEditGroupNotice : undefined}
                  showArrow={canManageGroup}
                />
              </>
            )}
            {isTempConversation ? (
              <>
                <Divider />
                <GroupInfoRow
                  label={t('tempChats.inviteLink')}
                  value={t('tempChats.copyLink')}
                  onPress={() => void handleCopyTempChatInviteLink()}
                  showArrow={false}
                />
              </>
            ) : (
              <>
                <Divider />
                <GroupInfoRow label={t('qr.groupEntry')} onPress={handleOpenGroupQr} />
              </>
            )}
            <Divider />
            <GroupInfoRow label={t('chat.searchHistory')} onPress={handleOpenSearchHistory} />
            <Divider />
            <GroupInfoRow
              label={t('chat.groupLog', { defaultValue: '群日志' })}
              onPress={handleOpenGroupLog}
            />
          </View>

          <View style={[s.groupSection, d.groupSection]}>
            <GroupInfoRow
              label={t('chat.muteNotification')}
              hasToggle={!actionPending.mute}
              toggleValue={muted}
              onToggle={actionPending.mute ? undefined : handleToggleMuted}
              showArrow={false}
            />
            <Divider />
            <GroupInfoRow
              label={t('chat.pinChat')}
              hasToggle={!actionPending.pin}
              toggleValue={pinned}
              onToggle={actionPending.pin ? undefined : handleTogglePinned}
              showArrow={false}
            />
            {canManageGroup ? (
              <>
                <Divider />
                <GroupInfoRow
                  label={t('chat.burnAfterReading')}
                  value={
                    burnDurationSec
                      ? formatBurnDuration(burnDurationSec)
                      : t('chat.burnOff')
                  }
                  onPress={handleOpenBurnOptions}
                />
              </>
            ) : null}
            <Divider />
            <GroupInfoRow
              label={t('chat.clearHistory')}
              onPress={handleClearHistory}
              destructive
              showArrow={false}
            />
          </View>

          <View style={[s.groupSection, d.groupSection]}>
            <GroupInfoRow label={t('chat.chatBackground')} onPress={handleOpenChatBackground} />
          </View>

          <View style={[s.groupSection, d.groupSection]}>
            <GroupInfoRow label={t('chat.report.title')} onPress={handleOpenGroupReport} />
          </View>

          <View style={[d.groupSection]}>
            <Pressable style={s.leaveButton} onPress={handleLeaveGroup}>
              <Text style={d.leaveText}>{t('chat.leave')}</Text>
            </Pressable>
          </View>
        </ScrollView>
        <BurnDurationPicker
          visible={burnPickerVisible}
          options={burnOptions}
          selected={burnDurationSec ?? 0}
          onSelect={handleSelectBurnDuration}
          onClose={() => setBurnPickerVisible(false)}
        />
        <Modal
          transparent
          animationType="fade"
          visible={renameDialogVisible}
          onRequestClose={() => {
            if (!renameSubmittingRef.current) setRenameDialogVisible(false);
          }}
        >
          <View style={[s.renameBackdrop, d.renameBackdrop]}>
            <View style={[s.renameDialog, d.renameDialog]}>
              <Text style={[s.renameTitle, d.renameTitle]}>{t('chat.groupName')}</Text>
              <TextInput
                style={[s.renameInput, d.renameInput]}
                value={renameDraft}
                onChangeText={setRenameDraft}
                maxLength={64}
                autoFocus
                returnKeyType="done"
                editable={!renameSubmitting}
                onSubmitEditing={() => void handleSubmitStandaloneGroupRename()}
              />
              <View style={s.renameActions}>
                <Pressable
                  style={[s.renameButton, d.renameCancelButton]}
                  disabled={renameSubmitting}
                  onPress={() => setRenameDialogVisible(false)}
                  accessibilityRole="button"
                >
                  <Text style={d.renameCancelText}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  style={[
                    s.renameButton,
                    d.renameSaveButton,
                    renameSubmitting ? s.renameButtonDisabled : null,
                  ]}
                  disabled={renameSubmitting}
                  onPress={() => void handleSubmitStandaloneGroupRename()}
                  accessibilityRole="button"
                >
                  <Text style={d.renameSaveText}>{t('common.save')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('chat.chatInfo')} fallbackHref={backHref} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.section, d.section]}>
          <UserIconRow icons={displayIcons} compact />
          <MenuRow icon="create-outline" label={t('chat.setRemark')} onPress={handleOpenRemark} />
          <Divider />
          <MenuRow icon="pricetag-outline" label={t('chat.tags')} onPress={handleOpenTags} />
          <Divider />
          <MenuRow icon="search-outline" label={t('chat.searchHistory')} onPress={handleOpenSearchHistory} />
          <Divider />
          <MenuRow icon="image-outline" label={t('chat.chatBackground')} onPress={handleOpenChatBackground} />
          <Divider />
          <MenuRow
            icon="arrow-up-circle-outline"
            label={t('chat.pinChat')}
            hasToggle={!actionPending.pin}
            onToggle={actionPending.pin ? undefined : handleTogglePinned}
            toggleValue={pinned}
            rightText={actionPending.pin ? t('chat.pending') : undefined}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="notifications-off-outline"
            label={t('chat.muteNotification')}
            hasToggle={!actionPending.mute}
            onToggle={actionPending.mute ? undefined : handleToggleMuted}
            toggleValue={muted}
            rightText={actionPending.mute ? t('chat.pending') : undefined}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="flame-outline"
            label={t('chat.burnAfterReading')}
            rightText={
              burnDurationSec
                ? formatBurnDuration(burnDurationSec)
                : t('chat.burnOff')
            }
            onPress={handleOpenBurnOptions}
          />
          <Divider />
          <MenuRow
            icon="trash-outline"
            label={t('chat.clearHistory')}
            onPress={handleClearHistory}
          />
        </View>

        <View style={[s.section, d.section]}>
          <MenuRow icon="share-social-outline" label={t('chat.recommendFriend')} onPress={handleOpenRecommendFriend} />
          <Divider />
          <MenuRow
            icon="ban-outline"
            label={t('chat.addBlacklist')}
            hasToggle={!blacklistPending}
            toggleValue={blacklist}
            onToggle={handleToggleBlacklist}
            rightText={blacklistPending ? t('chat.pending') : undefined}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="warning-outline"
            label={t('chat.report.title')}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/messages/report-friend',
                params: { friendUserId: friendId, friendName },
              })
            }
          />
        </View>

        <View style={[s.section, d.section]}>
          <MenuRow
            icon="person-remove-outline"
            label={t('chat.deleteFriend')}
            destructive
            onPress={deletePending ? undefined : handleConfirmDeleteContact}
            rightText={deletePending ? t('chat.pending') : undefined}
          />
        </View>
      </ScrollView>
        <BurnDurationPicker
          visible={burnPickerVisible}
          options={burnOptions}
          selected={burnDurationSec ?? 0}
          onSelect={handleSelectBurnDuration}
          onClose={() => setBurnPickerVisible(false)}
        />
    </View>
  );
}

/** 焚毁档位选择面板(六档 + 关闭:Android 的 Alert 装不下这么多按钮)。 */
function BurnDurationPicker({
  visible,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  options: { value: number; label: string }[];
  selected: number;
  onSelect: (seconds: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <OptionPickerSheet
      visible={visible}
      title={t('chat.burnAfterReading')}
      options={options}
      selectedValue={selected}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
