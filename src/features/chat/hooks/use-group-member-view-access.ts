import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchCircleDetail } from '@/services/api/circles';
import { canViewCircleMembers } from '@/features/chat/group-member-permissions';
import { evictGroupInfoCache, readGroupInfoCache, writeGroupInfoCache } from '@/features/chat/group-info-cache';
import { useAuthStore } from '@/stores/authStore';
import { ApiError, isDefinitiveAuthFailure } from '@/services/api/client';

export interface GroupSelfMember {
  userID: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
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
  verificationFailed: boolean;
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
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const cacheKey = `circle:${groupID}`;
  // Carry the just-validated chat role into its info screen, retaining live refresh below.
  const cachedMember = useMemo(() => {
    const cached = enabled ? readGroupInfoCache(sessionEpoch, cacheKey)?.validatedAccess : undefined;
    return cached && cached.userID === currentUserID && cached.roleHint === roleHint &&
      Date.now() - cached.checkedAt < 30_000
      ? { userID: cached.userID, role: cached.role } : null;
  }, [cacheKey, currentUserID, enabled, roleHint, sessionEpoch]);
  const [selfMember, setSelfMember] = useState<GroupSelfMember | null>(cachedMember);
  const [resolved, setResolved] = useState(Boolean(cachedMember));
  const [verificationFailed, setVerificationFailed] = useState(false);
  // 换群/卸载后丢弃在途查询结果。
  const queryGenRef = useRef(0);
  const revalidateRef = useRef<(() => Promise<boolean>) | null>(null);

  const fetchSelf = useCallback(async (): Promise<GroupSelfMember | null> => {
    if (!enabled || !groupID || !currentUserID) return null;
    const gen = queryGenRef.current;
    const detail = await fetchCircleDetail(groupID);
    const role = detail.myStatus === 'ACTIVE' ? detail.myRole : null;
    if (gen === queryGenRef.current && useAuthStore.getState().sessionEpoch === sessionEpoch) {
      if (role) {
        writeGroupInfoCache(sessionEpoch, cacheKey, {
          validatedAccess: { userID: currentUserID, role, roleHint, checkedAt: Date.now() },
        });
      } else {
        evictGroupInfoCache(sessionEpoch, cacheKey);
      }
    }
    if (!role) return null;
    return {
      userID: currentUserID,
      role,
    };
  }, [cacheKey, currentUserID, enabled, groupID, roleHint, sessionEpoch]);

  useEffect(() => {
    if (!enabled || !groupID || !currentUserID) {
      setSelfMember(null);
      setResolved(true);
      setVerificationFailed(false);
      return;
    }
    setSelfMember(cachedMember);
    setResolved(Boolean(cachedMember));
    setVerificationFailed(false);
    queryGenRef.current += 1;
    const gen = queryGenRef.current;
    fetchSelf()
      .then((member) => {
        if (queryGenRef.current !== gen) return;
        setSelfMember(member);
        setResolved(true);
        setVerificationFailed(false);
      })
      .catch((error) => {
        if (queryGenRef.current !== gen) return;
        // fail-closed:查不到身份按无权处理。
        setSelfMember(null);
        setResolved(true);
        const denied = isDefinitiveAuthFailure(error) || (error instanceof ApiError && error.status === 404);
        setVerificationFailed(!denied);
        if (denied) evictGroupInfoCache(sessionEpoch, cacheKey);
        else writeGroupInfoCache(sessionEpoch, cacheKey, { validatedAccess: undefined });
      });
    return () => {
      queryGenRef.current += 1;
    };
  }, [cachedMember, currentUserID, enabled, fetchSelf, groupID, sessionEpoch, cacheKey]);

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

  // 从被盖住回到前台时重查；角色变化由上面的入口查询负责。
  const lastActiveRef = useRef(active);
  useEffect(() => {
    const becameActive = active && !lastActiveRef.current;
    lastActiveRef.current = active;
    if (!enabled || !groupID || !currentUserID) return;
    if (becameActive) {
      void revalidateRef.current?.();
    }
  }, [active, currentUserID, enabled, groupID]);

  const revalidate = useCallback(async () => {
    if (!enabled || !groupID || !currentUserID) return false;
    const gen = queryGenRef.current;
    try {
      const member = await fetchSelf();
      if (queryGenRef.current === gen) {
        setSelfMember(member);
        setResolved(true);
        setVerificationFailed(false);
      }
      return (
        canViewCircleMembers(member?.role ?? null) ||
        (member?.role === 'MEMBER' && membersCanViewRoster === true)
      );
    } catch (error) {
      // fail-closed:查询失败一律按无权处理,绝不放行受保护操作。
      if (queryGenRef.current === gen) {
        setSelfMember(null);
        setResolved(true);
        const denied = isDefinitiveAuthFailure(error) || (error instanceof ApiError && error.status === 404);
        setVerificationFailed(!denied);
        if (denied) evictGroupInfoCache(sessionEpoch, cacheKey);
        else writeGroupInfoCache(sessionEpoch, cacheKey, { validatedAccess: undefined });
      }
      return false;
    }
  }, [cacheKey, currentUserID, enabled, fetchSelf, groupID, membersCanViewRoster, sessionEpoch]);

  // 定时/焦点回调里引用 revalidate 会形成声明顺序上的循环,用 ref 转一手。
  revalidateRef.current = revalidate;

  const canViewMembers = useMemo(
    () =>
      canViewCircleMembers(selfMember?.role ?? null) ||
      (selfMember?.role === 'MEMBER' && membersCanViewRoster === true),
    [membersCanViewRoster, selfMember],
  );

  return { canViewMembers, selfMember, resolved, verificationFailed, revalidate };
}
