import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GroupMemberItem } from '@openim/rn-client-sdk';
import {
  loadSpecifiedGroupMembers,
  subscribeGroupMemberSelfChanges,
} from '@/im/client';
import { canViewGroupMembers } from '@/features/chat/group-member-permissions';

/**
 * 群成员目录访问权（群主/管理员可看）的活体视图。
 *
 * review P1：权限不能是挂载时的一次性快照——群主在本页存活期间撤掉管理员时，
 * 被撤的人必须立刻失去成员资料/目录入口。两道防线：
 * 1. 订阅自己的群成员身份变化（角色变更/被移出/退群），实时更新 `selfMember`；
 * 2. `revalidate()` 给受保护操作在执行前做 fail-closed 现场重查（事件丢失也兜底）。
 *
 * `selfMember` 是唯一事实源（roleLevel/群昵称都从它派生），`resolved` 表示
 * 首次查询已落定——未落定前调用方应显示加载态而不是受限文案。
 */
export function useGroupMemberViewAccess(params: {
  enabled: boolean;
  groupID: string;
  currentUserID: string | null | undefined;
}): {
  canViewMembers: boolean;
  selfMember: GroupMemberItem | null;
  resolved: boolean;
  revalidate: () => Promise<boolean>;
} {
  const { enabled, groupID, currentUserID } = params;
  const [selfMember, setSelfMember] = useState<GroupMemberItem | null>(null);
  const [resolved, setResolved] = useState(false);

  // review R3：角色变更事件永远比在途的成员查询更新鲜。一次性快照查询
  // （挂载首查 / revalidate）若在返回前被订阅事件超车，其陈旧结果不能覆盖
  // 事件写入的值——否则被撤权的管理员会因为旧的 admin 响应晚到而重获权限。
  // 用单调事件代际 + 最近事件成员快照实现：查询开始时记下代际，返回时若代际
  // 已被事件推进，丢弃查询结果、以事件的值为准。
  const eventGenRef = useRef(0);
  const lastEventMemberRef = useRef<GroupMemberItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !groupID || !currentUserID) {
      setSelfMember(null);
      setResolved(true);
      return () => {
        cancelled = true;
      };
    }

    setSelfMember(null);
    setResolved(false);
    const genAtStart = eventGenRef.current;
    loadSpecifiedGroupMembers(groupID, [currentUserID])
      .then(([member]) => {
        // cancelled：换群/卸载；代际推进：本群已来更新鲜的角色事件。
        if (cancelled || eventGenRef.current !== genAtStart) return;
        setSelfMember(member ?? null);
        setResolved(true);
      })
      .catch(() => {
        if (cancelled || eventGenRef.current !== genAtStart) return;
        setSelfMember(null);
        setResolved(true);
      });

    const unsubscribe = subscribeGroupMemberSelfChanges(
      groupID,
      currentUserID,
      (member) => {
        eventGenRef.current += 1;
        lastEventMemberRef.current = member;
        if (!cancelled) {
          setSelfMember(member);
          setResolved(true);
        }
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentUserID, enabled, groupID]);

  const revalidate = useCallback(async () => {
    if (!enabled || !groupID || !currentUserID) return false;
    const genAtStart = eventGenRef.current;
    try {
      const [member] = await loadSpecifiedGroupMembers(groupID, [
        currentUserID,
      ]);
      // review R3：查询在途时来了角色事件——事件更新鲜，按事件的成员判定，
      // 绝不用可能过期的查询结果放行受保护操作。
      if (eventGenRef.current !== genAtStart) {
        return canViewGroupMembers(lastEventMemberRef.current?.roleLevel);
      }
      const next = member ?? null;
      setSelfMember(next);
      setResolved(true);
      return canViewGroupMembers(next?.roleLevel);
    } catch {
      if (eventGenRef.current !== genAtStart) {
        return canViewGroupMembers(lastEventMemberRef.current?.roleLevel);
      }
      // fail-closed：查询失败一律按无权处理，绝不放行。
      setSelfMember(null);
      setResolved(true);
      return false;
    }
  }, [currentUserID, enabled, groupID]);

  const canViewMembers = useMemo(
    () => canViewGroupMembers(selfMember?.roleLevel),
    [selfMember],
  );

  return { canViewMembers, selfMember, resolved, revalidate };
}
