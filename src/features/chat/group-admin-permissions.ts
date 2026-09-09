import type { ChatMemberDto } from '@/chat-core/protocol';

/**
 * 群管理的角色判定(纯函数;与后端 chat-group-roles.ts 逐条镜像)。
 *
 * 前端放宽一点,普通成员就会拿到一个必然 403 的按钮;收紧一点,群主就找不到入口。
 * 所以这里不发明规则,只复述服务端的:群主可动管理员与成员,管理员只能动普通成员,
 * 谁都动不了群主与自己;设/撤管理员只有群主能做。
 */
export type GroupRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export function isGroupManager(role: GroupRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function canManageGroupTarget(
  actor: GroupRole | null | undefined,
  target: GroupRole | null | undefined,
): boolean {
  if (!actor || !target) return false;
  if (actor === 'OWNER') return target !== 'OWNER';
  if (actor === 'ADMIN') return target === 'MEMBER';
  return false;
}

export function canAssignGroupRole(
  actor: GroupRole | null | undefined,
  target: GroupRole | null | undefined,
): boolean {
  return actor === 'OWNER' && Boolean(target) && target !== 'OWNER';
}

/**
 * 独立群聊里本人的角色:成员目录是事实源(服务端按 ownerId + 座位上的管理员标记
 * 派生);目录还没到位或老后端不返角色时,只能认会话 dto 的 ownerId。
 */
export function resolveStandaloneSelfRole(params: {
  members: readonly Pick<ChatMemberDto, 'userId' | 'role'>[];
  currentUserID: string | null | undefined;
  ownerId: string | null | undefined;
}): GroupRole | null {
  const { members, currentUserID, ownerId } = params;
  if (!currentUserID) return null;
  const self = members.find((member) => member.userId === currentUserID);
  if (self?.role) return self.role;
  if (ownerId && ownerId === currentUserID) return 'OWNER';
  return self ? 'MEMBER' : null;
}
