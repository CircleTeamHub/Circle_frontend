const NORMAL_ROLE = 20;
const ADMIN_ROLE = 60;
const OWNER_ROLE = 100;

export function canViewGroupMembers(roleLevel?: number | null): boolean {
  return roleLevel === OWNER_ROLE || roleLevel === ADMIN_ROLE;
}

export function canViewCircleMembers(role?: 'OWNER' | 'ADMIN' | 'MEMBER' | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** 圈子角色 → OpenIM roleLevel 兼容数字(ChatInfo 迁移完成后可删)。 */
export function roleLevelFromCircleRole(
  role: 'OWNER' | 'ADMIN' | 'MEMBER',
): number {
  if (role === 'OWNER') return OWNER_ROLE;
  if (role === 'ADMIN') return ADMIN_ROLE;
  return NORMAL_ROLE;
}

export function canChangeGroupMemberRole(actorRoleLevel?: number | null, targetRoleLevel?: number | null): boolean {
  return actorRoleLevel === OWNER_ROLE && (targetRoleLevel === NORMAL_ROLE || targetRoleLevel === ADMIN_ROLE);
}

/**
 * 受保护操作（打开成员资料 / 群目录发起通话）执行前的 fail-closed 重校验：
 * 不信任挂载时的权限快照，现场重查自己的角色。查询抛错、SDK 未就绪、
 * 已不在群里（selfMember 为空）一律按无权处理。
 */
export async function revalidateGroupMemberView(params: {
  loadSelfMember: () => Promise<{ roleLevel?: number | null } | null | undefined>;
}): Promise<boolean> {
  try {
    const selfMember = await params.loadSelfMember();
    return canViewGroupMembers(selfMember?.roleLevel);
  } catch {
    return false;
  }
}

export async function loadAuthorizedGroupMembers<T extends { roleLevel?: number | null }>(params: {
  loadCurrentMember: () => Promise<T | null>;
  loadMembers: () => Promise<T[]>;
}): Promise<{
  currentMember: T | null;
  members: T[];
  authorized: boolean;
  /** review R2：成员表加载失败 ≠ 无权限。authorized 已确认时把加载错误单独
   * 暴露，调用方应显示"加载失败"而不是受限文案（那会误导管理员且没有恢复
   * 入口）。null 表示成员表加载成功或根本无权加载。 */
  membersError: unknown;
}> {
  const currentMember = await params.loadCurrentMember();
  const authorized = canViewGroupMembers(currentMember?.roleLevel);
  if (!authorized) {
    return { currentMember, members: [], authorized, membersError: null };
  }
  try {
    return {
      currentMember,
      members: await params.loadMembers(),
      authorized,
      membersError: null,
    };
  } catch (error) {
    return {
      currentMember,
      members: [],
      authorized,
      membersError: error ?? new Error('group member list load failed'),
    };
  }
}
