import { useEffect, useState } from 'react';
import { fetchChatGroupManagers } from '@/chat-core/api';
import type { ChatGroupManagerDto } from '@/chat-core/protocol';
import { reportHandledFailure } from '@/observability/report-failure';

export type GroupManagerRoles = Readonly<Record<string, ChatGroupManagerDto['role']>>;

const NO_MANAGERS: GroupManagerRoles = {};
// 再次打开同一个群时先用上次的名单,标签不用等网络回来才冒出来。名单属于群本身,
// 换账号也一样:不在群里的账号根本打不开这个会话。
const lastKnownRoles = new Map<string, GroupManagerRoles>();

/**
 * 群主/管理员 userId → 角色,给聊天里他们的发言标【群主】【管理员】。
 * 单独走 managers 接口而不是成员目录:普通成员常常看不到名单(「显示群成员」关着),
 * 但谁是群主/管理员要对所有人可见。每次进群拉一次;群里换人期间不实时跟。
 */
export function useGroupManagerRoles(conversationId: string, enabled: boolean): GroupManagerRoles {
  const [roles, setRoles] = useState<GroupManagerRoles>(
    () => (enabled ? lastKnownRoles.get(conversationId) : undefined) ?? NO_MANAGERS,
  );

  useEffect(() => {
    if (!enabled) {
      setRoles(NO_MANAGERS);
      return;
    }
    setRoles(lastKnownRoles.get(conversationId) ?? NO_MANAGERS);
    let cancelled = false;
    fetchChatGroupManagers(conversationId)
      .then((managers) => {
        const next: GroupManagerRoles = Object.fromEntries(
          managers.map((manager) => [manager.userId, manager.role]),
        );
        lastKnownRoles.set(conversationId, next);
        if (!cancelled) setRoles(next);
      })
      .catch((error) => {
        reportHandledFailure('chatDetail', 'loadGroupManagers', error);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, enabled]);

  return roles;
}
