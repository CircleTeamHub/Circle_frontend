import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
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

/** 停留在受保护屏幕上时的兜底重校验周期。 */
const REVALIDATE_INTERVAL_MS = 60_000;

/**
 * 群成员目录访问权（群主/管理员可看）的活体视图 —— chat-core 版。
 * 事实源从 OpenIM 群成员换成圈子角色(fetchCircleDetail().myRole)。
 *
 * review P1 的防线在新栈下的形态:
 * 1. 自研栈暂无成员角色推送,所以靠「App 回前台 + 定时」重新校验 ——
 *    被撤职的管理员留在 ChatInfoScreen 上不动时,只靠首查快照会让已经
 *    加载出来的成员名单(昵称/头像)一直可见;
 * 2. `revalidate()` fail-closed:查询失败/查无身份一律按无权处理;
 * 3. 一旦判定失权,立刻把 selfMember 置空 —— canViewMembers 随之为 false,
 *    调用方据此清掉目录数据,而不是留在屏幕上等下一次交互。
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
  const revalidateRef = useRef<(() => Promise<boolean>) | null>(null);

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

  // 回前台 + 定时重校验:用户一直停在本屏不做任何操作时,撤职也要能生效。
  // 刻意不用 useFocusEffect —— 那会把这个 hook 绑死在 navigator 上,
  // 而它需要能在任何宿主(含单元测试)里独立工作。
  useEffect(() => {
    if (!enabled || !groupID || !currentUserID) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void revalidateRef.current?.();
    });
    const timer = setInterval(() => {
      void revalidateRef.current?.();
    }, REVALIDATE_INTERVAL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [currentUserID, enabled, groupID]);

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

  // 定时/焦点回调里引用 revalidate 会形成声明顺序上的循环,用 ref 转一手。
  revalidateRef.current = revalidate;

  const canViewMembers = useMemo(
    () => canViewCircleMembers(selfMember?.role ?? null),
    [selfMember],
  );

  return { canViewMembers, selfMember, resolved, revalidate };
}
