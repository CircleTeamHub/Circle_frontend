import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { GroupMemberRole, SessionType, type GroupItem, type GroupMemberItem } from '@openim/rn-client-sdk';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import { Avatar } from '@/components/ui/avatar';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { buildChatInfoState } from '@/features/chat/chat-info';
import {
  clearConversationMessages,
  fromImUserId,
  getGroupInfo,
  getOrCreateSingleConversation,
  kickGroupMembers,
  leaveGroupChat,
  loadGroupMemberList,
  setConversationBurnDuration,
  setConversationMute,
  toggleConversationPinned,
  updateGroupMemberAlias,
  updateGroupName,
} from '@/im/client';
import {
  getChatDetailHref,
  getChatBackgroundHref,
  getChatHistorySearchHubHref,
  getEditGroupNoticeHref,
  getEditFriendRemarkHref,
  getEditFriendTagsHref,
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
import { fetchUserProfile } from '@/services/api/profile';
import { leaveGroup, removeGroupMember } from '@/services/api/groups';
import { getApiErrorMessage } from '@/services/api/errors';
import { useIMStore } from '@/stores/imStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { DisplayIcon } from '@/types';

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
});

const initialActionPending = {
  pin: false,
  mute: false,
  burn: false,
  clear: false,
};
const GROUP_MEMBER_COLUMNS = 5;
const COLLAPSED_GROUP_MEMBER_ROWS = 4;
const GROUP_MEMBER_PROFILE_REFRESH_LIMIT = 200;

type ConversationActionKey = keyof typeof initialActionPending;
type OptimisticConversationState = {
  pinned?: boolean;
  muted?: boolean;
  burnDuration?: number;
};
type OptimisticConversationStateKey = keyof OptimisticConversationState;

async function refreshGroupMemberProfiles(
  members: GroupMemberItem[],
): Promise<GroupMemberItem[]> {
  const membersToRefresh = members.slice(0, GROUP_MEMBER_PROFILE_REFRESH_LIMIT);
  const profileResults = await Promise.allSettled(
    membersToRefresh.map((member) => fetchUserProfile(fromImUserId(member.userID))),
  );
  const profilesById = new Map<
    string,
    Awaited<ReturnType<typeof fetchUserProfile>>
  >();
  for (const result of profileResults) {
    if (result.status === 'fulfilled') {
      profilesById.set(result.value.id, result.value);
    }
  }

  if (profilesById.size === 0) {
    return members;
  }

  return members.map((member) => {
    const profile = profilesById.get(fromImUserId(member.userID));
    if (!profile) {
      return member;
    }

    return {
      ...member,
      nickname: profile.nickname || member.nickname,
      faceURL: profile.avatarUrl ?? member.faceURL,
    };
  });
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
          <Switch
            value={toggleValue}
            onValueChange={onToggle}
            trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
            thumbColor={colors.white}
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
    originScope?: string;
  }>();
  const [blacklist, setBlacklist] = useState(false);
  const [blacklistPending, setBlacklistPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [groupInfo, setGroupInfo] = useState<GroupItem | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMemberItem[]>([]);
  const [groupMembersExpanded, setGroupMembersExpanded] = useState(false);
  const [kickPendingUserID, setKickPendingUserID] = useState<string | null>(null);
  // friend-scoped 动作（拉黑 / 删除）不走 runConversationAction（那个绑会话）；
  // 用 ref 做 fast double-tap 单飞行守，跟其他屏的 Pattern D 二道闸保持一致。
  const blacklistInFlightRef = useRef(false);
  const deleteInFlightRef = useRef(false);
  const [actionPending, setActionPending] = useState(initialActionPending);
  const actionPendingRef = useRef(initialActionPending);
  const actionRequestTokenRef = useRef({
    pin: 0,
    mute: 0,
    burn: 0,
    clear: 0,
  });
  const currentConversationIDRef = useRef('');
  const [optimisticConversationState, setOptimisticConversationState] = useState<OptimisticConversationState>({});
  const conversations = useIMStore((state) => state.conversations);

  // 来源可能是 OpenIM 去连字符的 32 位 hex（从会话列表跳进来）或后端的 UUID
  // （从联系人/资料页跳进来）。两种用途要区分：
  //   - friendId：所有业务后端 /friend/* 接口都被 ParseUUIDPipe 校验，必须 UUID。
  //   - routeSourceID：保留原始形式，用来按 conversation.userID 在 IM 会话列表里查找。
  const rawFriendId =
    typeof params.id === 'string' ? params.id : typeof params.sourceID === 'string' ? params.sourceID : '';
  const friendId = rawFriendId ? fromImUserId(rawFriendId) : '';
  const friendName =
    typeof params.name === 'string' ? params.name : typeof params.title === 'string' ? params.title : t('chat.friend');
  const friendFallbackName =
    typeof params.fallbackName === 'string' && params.fallbackName.trim()
      ? params.fallbackName.trim()
      : friendName;
  const routeSourceID = friendId;
  const rawRouteSourceID = rawFriendId;
  const originScope =
    params.originScope === 'contacts' || params.originScope === 'profile' || params.originScope === 'discover'
      ? params.originScope
      : 'messages';
  const scope = originScope;
  const conversationID = typeof params.conversationID === 'string' ? params.conversationID : '';
  const conversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.conversationID === conversationID) ??
      conversations.find(
        (conversation) => conversation.userID === routeSourceID || conversation.groupID === routeSourceID,
      ) ??
      conversations.find(
        (conversation) => conversation.userID === rawRouteSourceID || conversation.groupID === rawRouteSourceID,
      ) ??
      null,
    [conversationID, conversations, rawRouteSourceID, routeSourceID],
  );
  const isGroupConversation =
    params.conversationType === 'group' ||
    conversation?.conversationType === SessionType.Group ||
    Boolean(conversation?.groupID && !conversation?.userID);
  const groupID = isGroupConversation ? conversation?.groupID || rawRouteSourceID : '';
  const groupTitle = groupInfo?.groupName || conversation?.showName || friendName || t('chat.groupChat');
  const groupNotice = groupInfo?.notification?.trim() ?? '';
  const memberCount = groupInfo?.memberCount ?? groupMembers.length;
  const currentUserID = useIMStore((state) => state.currentUserID);
  const myGroupAlias = groupMembers.find((member) => member.userID === currentUserID)?.nickname ?? '';
  const currentMember = useMemo(
    () => groupMembers.find((member) => member.userID === currentUserID) ?? null,
    [currentUserID, groupMembers],
  );
  const currentRole = currentMember?.roleLevel ?? GroupMemberRole.Normal;
  const isOwner = currentRole === GroupMemberRole.Owner;
  const isAdmin = currentRole === GroupMemberRole.Admin;
  const canManageGroup = isOwner || isAdmin;
  const collapsedGroupMemberLimit = GROUP_MEMBER_COLUMNS * COLLAPSED_GROUP_MEMBER_ROWS - (canManageGroup ? 1 : 0);
  const visibleGroupMembers = useMemo(
    () => (groupMembersExpanded ? groupMembers : groupMembers.slice(0, collapsedGroupMemberLimit)),
    [collapsedGroupMemberLimit, groupMembers, groupMembersExpanded],
  );
  const resolvedConversationID = conversation?.conversationID ?? '';
  currentConversationIDRef.current = resolvedConversationID;
  const baseState = useMemo(() => buildChatInfoState(conversation), [conversation]);
  const displayIcons = useMemo(() => [] as DisplayIcon[], []);
  const backHref = useMemo(() => {
    if (originScope === 'messages') {
      if (isGroupConversation) {
        return {
          pathname: '/(tabs)/messages/chat-detail',
          params: {
            sourceID: groupID || routeSourceID,
            title: groupTitle,
            conversationType: 'group',
            ...(resolvedConversationID || conversationID
              ? { conversationID: resolvedConversationID || conversationID }
              : {}),
            ...(conversation?.faceURL ? { avatarUrl: conversation.faceURL } : {}),
          },
        } as const;
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
    conversation?.faceURL,
    friendId,
    friendName,
    groupID,
    groupTitle,
    isGroupConversation,
    originScope,
    resolvedConversationID,
    routeSourceID,
  ]);
  const pinned = optimisticConversationState.pinned ?? baseState.pinned;
  const muted = optimisticConversationState.muted ?? baseState.muted;
  const burnDuration = optimisticConversationState.burnDuration ?? conversation?.burnDuration ?? 0;
  const hasOptimisticConversationState =
    optimisticConversationState.pinned !== undefined ||
    optimisticConversationState.muted !== undefined ||
    optimisticConversationState.burnDuration !== undefined;
  const burnLabel = useMemo(
    () =>
      buildChatInfoState({
        isPinned: pinned,
        recvMsgOpt: muted ? 2 : 0,
        burnDuration,
      }).burnLabel,
    [burnDuration, muted, pinned],
  );
  const burnDurationOptions = useMemo(
    () => [
      { label: t('chat.burnOff'), duration: 0 },
      { label: t('chat.burn10s'), duration: 10 },
      { label: t('chat.burn1m'), duration: 60 },
      { label: t('chat.burn5m'), duration: 300 },
    ],
    [t],
  );

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

      if (!isGroupConversation || !groupID) {
        setGroupInfo(null);
        setGroupMembers([]);
        return () => {
          cancelled = true;
        };
      }

      getGroupInfo(groupID)
        .then((nextGroupInfo) => {
          if (!cancelled) {
            setGroupInfo(nextGroupInfo);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setGroupInfo(null);
          }
        });

      loadGroupMemberList(groupID, 10_000)
        .then(async (members) => {
          if (!cancelled) {
            setGroupMembers(members);
          }
          const refreshedMembers = await refreshGroupMemberProfiles(members);
          if (!cancelled) {
            setGroupMembers(refreshedMembers);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setGroupMembers([]);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [groupID, isGroupConversation]),
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

      if (current.pinned !== undefined && current.pinned === baseState.pinned) {
        delete nextState.pinned;
        changed = true;
      }

      if (current.muted !== undefined && current.muted === baseState.muted) {
        delete nextState.muted;
        changed = true;
      }

      if (current.burnDuration !== undefined && current.burnDuration === (conversation?.burnDuration ?? 0)) {
        delete nextState.burnDuration;
        changed = true;
      }

      return changed ? nextState : current;
    });
  }, [baseState.muted, baseState.pinned, conversation?.burnDuration, hasOptimisticConversationState]);

  const openActionError = useCallback(
    (error: unknown) => {
      if (__DEV__) {
        console.warn('[chat-info] action failed', error);
      }
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
      const conversation = await getOrCreateSingleConversation(friendId);
      return conversation.conversationID;
    } catch (error) {
      openActionError(error);
      return '';
    }
  }, [friendId, openActionError, resolvedConversationID]);

  const handleOpenSearchHistory = useCallback(() => {
    void (async () => {
      const nextConversationID = await resolveConversationIDForNavigation();

      if (!nextConversationID) {
        return;
      }

      router.push(getChatHistorySearchHubHref(nextConversationID, routeSourceID, friendName));
    })();
  }, [friendName, resolveConversationIDForNavigation, routeSourceID]);

  const handleOpenSearchGroupMembers = useCallback(() => {
    if (!groupID) {
      return;
    }

    router.push(
      getGroupMemberSearchHref(scope, {
        groupID,
        groupTitle,
      }),
    );
  }, [groupID, groupTitle, scope]);

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
    if (!groupID) {
      return;
    }

    promptForText(t('chat.groupName'), groupTitle, (value) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === groupTitle) {
        return;
      }

      updateGroupName(groupID, trimmed)
        .then(() => {
          setGroupInfo((current) => (current ? { ...current, groupName: trimmed } : current));
        })
        .catch(openActionError);
    });
  }, [groupID, groupTitle, openActionError, promptForText, t]);

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

  const handleEditMyGroupAlias = useCallback(() => {
    if (!groupID || !currentUserID) {
      return;
    }

    promptForText(t('chat.myAliasInGroup'), myGroupAlias, (value) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === myGroupAlias) {
        return;
      }

      updateGroupMemberAlias(groupID, currentUserID, trimmed)
        .then(() => {
          setGroupMembers((members) =>
            members.map((member) => (member.userID === currentUserID ? { ...member, nickname: trimmed } : member)),
          );
        })
        .catch(openActionError);
    });
  }, [currentUserID, groupID, myGroupAlias, openActionError, promptForText, t]);

  const handleOpenInviteGroupMembers = useCallback(() => {
    if (!groupID) {
      return;
    }

    router.push({
      pathname: '/(tabs)/messages/invite-group-members',
      params: {
        groupID,
        groupName: groupTitle,
      },
    });
  }, [groupID, groupTitle]);

  const handleOpenMemberProfile = useCallback(
    (member: GroupMemberItem) => {
      if (!member.userID) {
        return;
      }

      router.push(getUserProfileHref(scope, fromImUserId(member.userID), member.nickname || undefined));
    },
    [scope],
  );

  const handleKickMember = useCallback(
    (member: GroupMemberItem) => {
      if (!groupID || !canManageGroup || member.userID === currentUserID) {
        return;
      }

      // 群主可以踢任何人；管理员只能踢普通成员。
      if (!isOwner && member.roleLevel !== GroupMemberRole.Normal) {
        return;
      }

      const memberName = member.nickname || member.userID;

      Alert.alert(t('chat.removeMember'), t('chat.removeMemberConfirm', { name: memberName }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('chat.remove'),
          style: 'destructive',
          onPress: () => {
            setKickPendingUserID(member.userID);
            removeGroupMember(groupID, member.userID)
              .then((result) => {
                if (!result.handled) {
                  return kickGroupMembers(groupID, [member.userID]);
                }
                return undefined;
              })
              .then(() => {
                setGroupMembers((members) => members.filter((m) => m.userID !== member.userID));
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
    if (!groupID) {
      return;
    }

    Alert.alert(t('chat.leaveGroup'), t('chat.leaveGroupWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.leave'),
        style: 'destructive',
        onPress: () => {
          leaveGroupChat(groupID)
            .then(() =>
              leaveGroup(groupID).catch((error) => {
                if (__DEV__) {
                  console.warn('[chat] group leave backend cleanup failed', error);
                }
              }),
            )
            .then(() => router.replace('/(tabs)/messages'))
            .catch(openActionError);
        },
      },
    ]);
  }, [groupID, openActionError, t]);

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
        () => toggleConversationPinned(resolvedConversationID, nextPinned),
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
          await setConversationMute(resolvedConversationID, nextMuted);
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

  const applyBurnDuration = useCallback(
    (nextBurnDuration: number) => {
      if (!resolvedConversationID || actionPending.burn || nextBurnDuration === burnDuration) {
        return;
      }

      void runConversationAction(
        'burn',
        () => setConversationBurnDuration(resolvedConversationID, nextBurnDuration),
        () =>
          setOptimisticConversationState((current) => ({
            ...current,
            burnDuration: nextBurnDuration,
          })),
        () => dropOptimisticConversationStateKey('burnDuration'),
      );
    },
    [
      actionPending.burn,
      burnDuration,
      dropOptimisticConversationStateKey,
      resolvedConversationID,
      runConversationAction,
    ],
  );

  const handleOpenBurnDurationPicker = useCallback(() => {
    if (!resolvedConversationID || actionPending.burn) {
      return;
    }

    Alert.alert(
      t('chat.burnMessage'),
      t('chat.selectBurnTime'),
      [
        ...burnDurationOptions.map(({ label, duration }) => ({
          text: label,
          onPress: () => applyBurnDuration(duration),
        })),
        { text: t('common.cancel'), style: 'cancel' as const },
      ],
      { cancelable: true },
    );
  }, [actionPending.burn, applyBurnDuration, burnDurationOptions, resolvedConversationID, t]);

  const handleConfirmClearHistory = useCallback(() => {
    if (!resolvedConversationID || actionPending.clear) {
      return;
    }

    Alert.alert(
      t('chat.clearHistory'),
      t('chat.clearHistoryWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' as const },
        {
          text: t('chat.clear'),
          style: 'destructive' as const,
          onPress: () => {
            void runConversationAction('clear', () => clearConversationMessages(resolvedConversationID));
          },
        },
      ],
      { cancelable: true },
    );
  }, [actionPending.clear, resolvedConversationID, runConversationAction, t]);

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
    }),
    [colors],
  );

  if (isGroupConversation) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader
          title={t('chat.groupInfoWithCount', { count: memberCount })}
          fallbackHref={backHref}
          rightIcon="search-outline"
          onRightPress={handleOpenSearchGroupMembers}
        />
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.groupContent, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.groupMemberSection}>
            <View style={s.groupMemberGrid}>
              {visibleGroupMembers.map((member) => {
                const memberName = member.nickname || member.userID;
                const roleBadge =
                  member.roleLevel === GroupMemberRole.Owner
                    ? t('chat.groupOwner')
                    : member.roleLevel === GroupMemberRole.Admin
                      ? t('chat.groupAdmin')
                      : null;
                const canKickMember =
                  canManageGroup &&
                  member.userID !== currentUserID &&
                  (isOwner || member.roleLevel === GroupMemberRole.Normal);

                return (
                  <Pressable
                    key={member.userID}
                    style={s.groupMemberCell}
                    onPress={() => handleOpenMemberProfile(member)}
                    onLongPress={canKickMember ? () => handleKickMember(member) : undefined}
                    disabled={kickPendingUserID === member.userID}
                  >
                    <Avatar size={56} shape="square" name={memberName} uri={member.faceURL} />
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
              {canManageGroup ? (
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

          <View style={[s.groupSection, d.groupSection]}>
            <GroupInfoRow
              label={t('chat.groupName')}
              value={groupTitle}
              onPress={canManageGroup ? handleEditGroupName : undefined}
              showArrow={canManageGroup}
            />
            <Divider />
            <GroupInfoRow
              label={t('chat.groupNotice')}
              subtitle={groupNotice || t('chat.noGroupNotice')}
              onPress={canManageGroup ? handleEditGroupNotice : undefined}
              showArrow={canManageGroup}
            />
            <Divider />
            <GroupInfoRow label={t('chat.searchHistory')} onPress={handleOpenSearchHistory} />
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
          </View>

          <View style={[s.groupSection, d.groupSection]}>
            <GroupInfoRow
              label={t('chat.myAliasInGroup')}
              value={myGroupAlias || t('chat.notSet')}
              onPress={handleEditMyGroupAlias}
            />
          </View>

          <View style={[s.groupSection, d.groupSection]}>
            <GroupInfoRow label={t('chat.chatBackground')} onPress={handleOpenChatBackground} />
          </View>

          <View style={[s.groupSection, d.groupSection]}>
            <GroupInfoRow
              label={t('chat.clearHistory')}
              onPress={actionPending.clear ? undefined : handleConfirmClearHistory}
              showArrow={false}
            />
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
            label={t('chat.burnMessage')}
            onPress={actionPending.burn ? undefined : handleOpenBurnDurationPicker}
            rightText={actionPending.burn ? t('chat.pending') : burnLabel}
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
            icon="trash-outline"
            label={t('chat.clearHistory')}
            onPress={actionPending.clear ? undefined : handleConfirmClearHistory}
            rightText={actionPending.clear ? t('chat.pending') : undefined}
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
    </View>
  );
}
