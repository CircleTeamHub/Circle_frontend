import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchCircleDetail } from '@/services/api/circles';
import {
  canViewCircleMembers,
  roleLevelFromCircleRole,
} from '@/features/chat/group-member-permissions';

export interface GroupSelfMember {
  userID: string;
  /** OpenIM roleLevel 兼容值(OWNER=100/ADMIN=60/MEMBER=20):ChatInfo 的
   *  角色管理仍按数字比较,圈子角色在此换算,该屏迁移后可删。 */
  roleLevel: number;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  /** 群内昵称:圈子模型暂无此概念,恒 undefined(ChatInfo 兜底到空串)。 */
  nickname?: string;
}

/**
 * 群成员目录访问权（群主/管理员可看）的活体视图 —— chat-core 版。
 * 事实源从 OpenIM 群成员换成圈子角色(fetchCircleDetail().myRole)。
 *
 * review P1 的两道防线在新栈下的形态:
 * 1. 实时角色事件:自研栈暂无成员角色推送(随系统消息批次落地),
 *    首查快照 + 受保护操作前的 revalidate() 现场重查是当前的全部防线;
 * 2. `revalidate()` fail-closed:查询失败/查无身份一律按无权处理。
 * 事件代际逻辑随订阅一起移除 —— 没有事件源时它只是死代码。
 */
export function useGroupMemberViewAccess(params: {
  enabled: boolean;
  /** 圈子 id(GROUP 会话的 sourceID)。 */
  groupID: string;
  currentUserID: string | null | undefined;
}): {
  canViewMembers: boolean;
  selfMember: GroupSelfMember | null;
  resolved: boolean;
  revalidate: () => Promise<boolean>;
} {
  const { enabled, groupID, currentUserID } = params;
  const [selfMember, setSelfMember] = useState<GroupSelfMember | null>(null);
  const [resolved, setResolved] = useState(false);
  // 换群/卸载后丢弃在途查询结果。
  const queryGenRef = useRef(0);

  const fetchSelf = useCallback(async (): Promise<GroupSelfMember | null> => {
    if (!enabled || !groupID || !currentUserID) return null;
    const detail = await fetchCircleDetail(groupID);
    const role = detail.myStatus === 'ACTIVE' ? detail.myRole : null;
    if (!role) return null;
    return {
      userID: currentUserID,
      role,
      roleLevel: roleLevelFromCircleRole(role),
    };
  }, [currentUserID, enabled, groupID]);

  useEffect(() => {
    if (!enabled || !groupID || !currentUserID) {
      setSelfMember(null);
      setResolved(true);
      return;
    }
    setSelfMember(null);
    setResolved(false);
    queryGenRef.current += 1;
    const gen = queryGenRef.current;
    fetchSelf()
      .then((member) => {
        if (queryGenRef.current !== gen) return;
        setSelfMember(member);
        setResolved(true);
      })
      .catch(() => {
        if (queryGenRef.current !== gen) return;
        // fail-closed:查不到身份按无权处理。
        setSelfMember(null);
        setResolved(true);
      });
    return () => {
      queryGenRef.current += 1;
    };
  }, [currentUserID, enabled, fetchSelf, groupID]);

  const revalidate = useCallback(async () => {
    if (!enabled || !groupID || !currentUserID) return false;
    const gen = queryGenRef.current;
    try {
      const member = await fetchSelf();
      if (queryGenRef.current === gen) {
        setSelfMember(member);
        setResolved(true);
      }
      return canViewCircleMembers(member?.role ?? null);
    } catch {
      // fail-closed:查询失败一律按无权处理,绝不放行受保护操作。
      if (queryGenRef.current === gen) {
        setSelfMember(null);
        setResolved(true);
      }
      return false;
    }
  }, [currentUserID, enabled, fetchSelf, groupID]);

  const canViewMembers = useMemo(
    () => canViewCircleMembers(selfMember?.role ?? null),
    [selfMember],
  );

  return { canViewMembers, selfMember, resolved, revalidate };
}
