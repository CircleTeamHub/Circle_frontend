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

/**
 * 停留在受保护屏幕上时的兜底重校验周期。只在页面处于前台时才跑:撤职/任命多数会
 * 刷新会话缓存里的角色(roleHint)、回前台也会重查,这里只兜「什么都没发生」的情况。
 * 原来是 60 秒且页面被盖住也在跑 —— 开着一个群就是每小时 60 次圈子详情请求。
 */
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

/**
 * 群成员目录访问权（群主/管理员豁免,普通成员按群规）的活体视图 —— chat-core 版。
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
  /**
   * 会话上的「显示群成员」策略。圈主/管理员始终放行;普通成员只有在
   * 策略明确打开时才可以访问目录。未拿到会话 DTO 时保持关闭,避免把
   * 圈子原本的私有目录在加载竞态里短暂暴露出来。
   */
  membersCanViewRoster?: boolean | null;
  /** 页面此刻是否在前台(调用方传 useIsFocused())。不在前台时不轮询,回来时重查一次。 */
  active?: boolean;
  /** 会话缓存里本人的角色:变了(撤职/任命)立刻重查,不等轮询。 */
  roleHint?: string | null;
}): {
  canViewMembers: boolean;
  selfMember: GroupSelfMember | null;
  resolved: boolean;
  revalidate: () => Promise<boolean>;
} {
  const {
    enabled,
    groupID,
    currentUserID,
    membersCanViewRoster,
    active = true,
    roleHint = null,
  } = params;
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

  // 回前台 + 页面在前台时的兜底重校验:用户一直停在本屏不做任何操作时,撤职也要能
  // 生效。页面是否在前台由调用方传入(active)—— 刻意不用 useFocusEffect,那会把这个
  // hook 绑死在 navigator 上,而它需要能在任何宿主(含单元测试)里独立工作。
  useEffect(() => {
    if (!enabled || !groupID || !currentUserID || !active) return;
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
  }, [active, currentUserID, enabled, groupID]);

  // 从被盖住回到前台、或者缓存里的角色变了:立刻重查一次(首次挂载由上面的查询负责)。
  const lastActiveRef = useRef(active);
  const lastRoleHintRef = useRef(roleHint);
  useEffect(() => {
    const becameActive = active && !lastActiveRef.current;
    const roleChanged = roleHint !== lastRoleHintRef.current;
    lastActiveRef.current = active;
    lastRoleHintRef.current = roleHint;
    if (!enabled || !groupID || !currentUserID) return;
    if (becameActive || (active && roleChanged)) {
      void revalidateRef.current?.();
    }
  }, [active, currentUserID, enabled, groupID, roleHint]);

  const revalidate = useCallback(async () => {
    if (!enabled || !groupID || !currentUserID) return false;
    const gen = queryGenRef.current;
    try {
      const member = await fetchSelf();
      if (queryGenRef.current === gen) {
        setSelfMember(member);
        setResolved(true);
      }
      return (
        canViewCircleMembers(member?.role ?? null) ||
        (member?.role === 'MEMBER' && membersCanViewRoster === true)
      );
    } catch {
      // fail-closed:查询失败一律按无权处理,绝不放行受保护操作。
      if (queryGenRef.current === gen) {
        setSelfMember(null);
        setResolved(true);
      }
      return false;
    }
  }, [currentUserID, enabled, fetchSelf, groupID, membersCanViewRoster]);

  // 定时/焦点回调里引用 revalidate 会形成声明顺序上的循环,用 ref 转一手。
  revalidateRef.current = revalidate;

  const canViewMembers = useMemo(
    () =>
      canViewCircleMembers(selfMember?.role ?? null) ||
      (selfMember?.role === 'MEMBER' && membersCanViewRoster === true),
    [membersCanViewRoster, selfMember],
  );

  return { canViewMembers, selfMember, resolved, revalidate };
}
