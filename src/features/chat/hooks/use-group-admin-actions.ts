import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  fetchChatMembers,
  removeGroupChatMember,
  setGroupChatMemberRole,
  silenceChatMember,
  unsilenceChatMember,
} from '@/chat-core/api';
import type { ChatMemberDto } from '@/chat-core/protocol';
import { isMemberSilencedNow } from '@/chat-core/silence-durations';
import { groupMemberDisplayName } from '@/features/chat/group-member-display';
import {
  canAssignGroupRole,
  canManageGroupTarget,
  type GroupRole,
  resolveStandaloneSelfRole,
} from '@/features/chat/group-admin-permissions';
import { fetchCircleDetail } from '@/services/api/circles';
import { removeGroupMember, updateGroupMemberRole } from '@/services/api/groups';

export interface GroupAdminActionsParams {
  /** 聊天会话 id(圈子群是取或建后的会话 id;未解析时为空串)。 */
  conversationID: string;
  /** 圈子 id;独立群聊/临时房为空串。 */
  groupID: string;
  isStandaloneGroup: boolean;
  currentUserID: string | null | undefined;
  /** 本人当前角色(活体快照;执行前还会现场重查)。 */
  selfRole: GroupRole | null;
  onMemberUpdated: (userId: string, patch: Partial<ChatMemberDto>) => void;
  onMemberRemoved: (userId: string) => void;
  onError: (error: unknown) => void;
}

export interface GroupAdminActions {
  pendingUserID: string | null;
  canChangeRole: (member: ChatMemberDto) => boolean;
  canKick: (member: ChatMemberDto) => boolean;
  canSilence: (member: ChatMemberDto) => boolean;
  changeRole: (member: ChatMemberDto, nextRole: 'ADMIN' | 'MEMBER') => void;
  changeRoleBatch: (
    members: readonly ChatMemberDto[],
    nextRole: 'ADMIN' | 'MEMBER',
  ) => Promise<void>;
  /** 带确认弹窗。 */
  kick: (member: ChatMemberDto) => void;
  silence: (member: ChatMemberDto, durationSec: number | null) => void;
  silenceBatch: (
    members: readonly ChatMemberDto[],
    durationSec: number | null,
  ) => Promise<void>;
  unsilence: (member: ChatMemberDto) => void;
}

/**
 * 群管理动作(设/撤管理员、移出、禁言/解除),两种群共用:圈子群的设角色/移出仍走
 * /group/... 端点(它们还要动 CircleMember),禁言走 chat 端点;独立群聊全部走 chat 端点。
 *
 * 每个动作执行前都**现场重查本人角色**(fail-closed):action sheet 打开到点确认之间
 * 可能已经被撤掉管理员,不能吃挂载时的快照。查不到一律按无权处理。
 */
export function useGroupAdminActions(
  params: GroupAdminActionsParams,
): GroupAdminActions {
  const { t } = useTranslation();
  const [pendingUserID, setPendingUserID] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  // 回调走 ref:调用方多半内联传入,不必为了 deps 稳定去 useCallback 一圈。
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const revalidateSelfRole = useCallback(async (): Promise<GroupRole | null> => {
    const { conversationID, groupID, isStandaloneGroup, currentUserID } =
      paramsRef.current;
    if (isStandaloneGroup) {
      if (!conversationID) return null;
      const members = await fetchChatMembers(conversationID);
      return resolveStandaloneSelfRole({
        members,
        currentUserID,
        ownerId: null,
      });
    }
    if (!groupID) return null;
    const detail = await fetchCircleDetail(groupID);
    return detail.myStatus === 'ACTIVE' ? detail.myRole : null;
  }, []);

  const run = useCallback(
    async (
      member: ChatMemberDto,
      allowed: (freshRole: GroupRole | null) => boolean,
      action: () => Promise<void>,
    ) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setPendingUserID(member.userId);
      try {
        let freshRole: GroupRole | null = null;
        try {
          freshRole = await revalidateSelfRole();
        } catch {
          freshRole = null;
        }
        if (!allowed(freshRole)) {
          Alert.alert(
            t('chat.ownerOnlyAction', {
              defaultValue: '仅群主或管理员可执行该操作。',
            }),
          );
          return;
        }
        await action();
      } catch (error) {
        paramsRef.current.onError(error);
      } finally {
        inFlightRef.current = false;
        setPendingUserID(null);
      }
    },
    [revalidateSelfRole, t],
  );

  const runBatch = useCallback(
    async (
      members: readonly ChatMemberDto[],
      allowed: (freshRole: GroupRole | null) => boolean,
      action: () => Promise<void>,
    ) => {
      if (inFlightRef.current || members.length === 0) return;
      inFlightRef.current = true;
      setPendingUserID(members[0]?.userId ?? null);
      try {
        let freshRole: GroupRole | null = null;
        try {
          freshRole = await revalidateSelfRole();
        } catch {
          freshRole = null;
        }
        if (!allowed(freshRole)) {
          Alert.alert(
            t('chat.ownerOnlyAction', {
              defaultValue: '仅群主或管理员可执行该操作。',
            }),
          );
          return;
        }
        await action();
      } catch (error) {
        paramsRef.current.onError(error);
      } finally {
        inFlightRef.current = false;
        setPendingUserID(null);
      }
    },
    [revalidateSelfRole, t],
  );

  const { selfRole, currentUserID } = params;
  const targetRole = (member: ChatMemberDto): GroupRole =>
    member.role ?? 'MEMBER';

  const canChangeRole = useCallback(
    (member: ChatMemberDto) =>
      member.userId !== currentUserID &&
      canAssignGroupRole(selfRole, targetRole(member)),
    [currentUserID, selfRole],
  );
  const canKick = useCallback(
    (member: ChatMemberDto) =>
      member.userId !== currentUserID &&
      canManageGroupTarget(selfRole, targetRole(member)),
    [currentUserID, selfRole],
  );

  const changeRole = useCallback(
    (member: ChatMemberDto, nextRole: 'ADMIN' | 'MEMBER') => {
      void run(
        member,
        (fresh) => canAssignGroupRole(fresh, targetRole(member)),
        async () => {
          const { conversationID, groupID, isStandaloneGroup } = paramsRef.current;
          if (isStandaloneGroup) {
            await setGroupChatMemberRole(conversationID, member.userId, nextRole);
          } else {
            await updateGroupMemberRole(groupID, member.userId, nextRole);
          }
          paramsRef.current.onMemberUpdated(member.userId, { role: nextRole });
          const name = groupMemberDisplayName(member);
          Alert.alert(
            t('common.done'),
            nextRole === 'ADMIN'
              ? t('chat.adminGranted', { name })
              : t('chat.adminRevoked', { name }),
          );
        },
      );
    },
    [run, t],
  );

  const changeRoleBatch = useCallback(
    (members: readonly ChatMemberDto[], nextRole: 'ADMIN' | 'MEMBER') =>
      runBatch(
        members,
        (fresh) => members.every((member) => canAssignGroupRole(fresh, targetRole(member))),
        async () => {
          const { conversationID, groupID, isStandaloneGroup } = paramsRef.current;
          const failures: unknown[] = [];
          for (const member of members) {
            try {
              if (isStandaloneGroup) {
                await setGroupChatMemberRole(conversationID, member.userId, nextRole);
              } else {
                await updateGroupMemberRole(groupID, member.userId, nextRole);
              }
              paramsRef.current.onMemberUpdated(member.userId, { role: nextRole });
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length > 0) throw failures[0];
          Alert.alert(
            t('common.done'),
            nextRole === 'ADMIN'
              ? t('chat.adminGranted', {
                  name: members.map(groupMemberDisplayName).join(', '),
                })
              : t('chat.adminRevoked', {
                  name: members.map(groupMemberDisplayName).join(', '),
                }),
          );
        },
      ),
    [runBatch, t],
  );

  const kick = useCallback(
    (member: ChatMemberDto) => {
      const name = groupMemberDisplayName(member);
      Alert.alert(t('chat.removeMember'), t('chat.removeMemberConfirm', { name }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('chat.remove'),
          style: 'destructive',
          onPress: () => {
            void run(
              member,
              (fresh) => canManageGroupTarget(fresh, targetRole(member)),
              async () => {
                const { conversationID, groupID, isStandaloneGroup } =
                  paramsRef.current;
                if (isStandaloneGroup) {
                  await removeGroupChatMember(conversationID, member.userId);
                } else {
                  await removeGroupMember(groupID, member.userId);
                }
                paramsRef.current.onMemberRemoved(member.userId);
                Alert.alert(t('chat.deleted'), t('chat.memberRemoved', { name }));
              },
            );
          },
        },
      ]);
    },
    [run, t],
  );

  const silence = useCallback(
    (member: ChatMemberDto, durationSec: number | null) => {
      void run(
        member,
        (fresh) => canManageGroupTarget(fresh, targetRole(member)),
        async () => {
          const result = await silenceChatMember(
            paramsRef.current.conversationID,
            member.userId,
            durationSec,
          );
          paramsRef.current.onMemberUpdated(member.userId, {
            silenced: result.silenced,
            silencedUntil: result.silencedUntil,
          });
          Alert.alert(
            t('common.done'),
            t('chat.memberSilenced', {
              name: groupMemberDisplayName(member),
              defaultValue: '已禁言 {{name}}。',
            }),
          );
        },
      );
    },
    [run, t],
  );

  const silenceBatch = useCallback(
    (members: readonly ChatMemberDto[], durationSec: number | null) =>
      runBatch(
        members,
        (fresh) => members.every((member) => canManageGroupTarget(fresh, targetRole(member))),
        async () => {
          const failures: unknown[] = [];
          for (const member of members) {
            try {
              const result = await silenceChatMember(
                paramsRef.current.conversationID,
                member.userId,
                durationSec,
              );
              paramsRef.current.onMemberUpdated(member.userId, {
                silenced: result.silenced,
                silencedUntil: result.silencedUntil,
              });
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length > 0) throw failures[0];
          Alert.alert(
            t('common.done'),
            t('chat.memberSilenced', {
              name: members.map(groupMemberDisplayName).join(', '),
            }),
          );
        },
      ),
    [runBatch, t],
  );

  const unsilence = useCallback(
    (member: ChatMemberDto) => {
      void run(
        member,
        (fresh) => canManageGroupTarget(fresh, targetRole(member)),
        async () => {
          const result = await unsilenceChatMember(
            paramsRef.current.conversationID,
            member.userId,
          );
          paramsRef.current.onMemberUpdated(member.userId, {
            silenced: result.silenced,
            silencedUntil: result.silencedUntil,
          });
          Alert.alert(
            t('common.done'),
            t('chat.memberUnsilenced', {
              name: groupMemberDisplayName(member),
              defaultValue: '已解除 {{name}} 的禁言。',
            }),
          );
        },
      );
    },
    [run, t],
  );

  return useMemo(
    () => ({
      pendingUserID,
      canChangeRole,
      canKick,
      // 禁言与移出是同一张权限矩阵;已在禁言中的成员由调用方改显示「解除禁言」。
      canSilence: canKick,
      changeRole,
      changeRoleBatch,
      kick,
      silence,
      silenceBatch,
      unsilence,
    }),
    [
      canChangeRole,
      canKick,
      changeRole,
      changeRoleBatch,
      kick,
      pendingUserID,
      silence,
      silenceBatch,
      unsilence,
    ],
  );
}

/** 供列表页筛「禁言中」用的同一判据(避免各处各写一遍到期判断)。 */
export const isSilencedMember = isMemberSilencedNow;
