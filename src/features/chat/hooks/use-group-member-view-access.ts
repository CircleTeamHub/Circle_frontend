import { useCallback, useEffect, useState } from 'react';
import {
  loadSpecifiedGroupMembers,
  subscribeGroupMemberSelfChanges,
} from '@/im/client';
import {
  canViewGroupMembers,
  revalidateGroupMemberView,
} from '@/features/chat/group-member-permissions';

/**
 * 群成员目录访问权（群主/管理员可看）的活体视图。
 *
 * review P1：权限不能是挂载时的一次性快照——群主在本页存活期间撤掉管理员时，
 * 被撤的人必须立刻失去成员资料/目录入口。两道防线：
 * 1. 订阅自己的群成员身份变化（角色变更/被移出/退群），实时收紧 `canViewMembers`；
 * 2. `revalidate()` 给受保护操作在执行前做 fail-closed 现场重查（事件丢失也兜底）。
 */
export function useGroupMemberViewAccess(params: {
  enabled: boolean;
  groupID: string;
  currentUserID: string | null | undefined;
}): { canViewMembers: boolean; revalidate: () => Promise<boolean> } {
  const { enabled, groupID, currentUserID } = params;
  const [canViewMembers, setCanViewMembers] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !groupID || !currentUserID) {
      setCanViewMembers(false);
      return () => {
        cancelled = true;
      };
    }

    setCanViewMembers(false);
    loadSpecifiedGroupMembers(groupID, [currentUserID])
      .then(([selfMember]) => {
        if (!cancelled) setCanViewMembers(canViewGroupMembers(selfMember?.roleLevel));
      })
      .catch(() => {
        if (!cancelled) setCanViewMembers(false);
      });

    const unsubscribe = subscribeGroupMemberSelfChanges(groupID, currentUserID, (member) => {
      if (!cancelled) setCanViewMembers(canViewGroupMembers(member?.roleLevel));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentUserID, enabled, groupID]);

  const revalidate = useCallback(async () => {
    if (!enabled || !groupID || !currentUserID) return false;
    const allowed = await revalidateGroupMemberView({
      loadSelfMember: async () =>
        (await loadSpecifiedGroupMembers(groupID, [currentUserID]))[0] ?? null,
    });
    setCanViewMembers(allowed);
    return allowed;
  }, [currentUserID, enabled, groupID]);

  return { canViewMembers, revalidate };
}
