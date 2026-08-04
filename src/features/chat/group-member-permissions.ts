const NORMAL_ROLE = 20;
const ADMIN_ROLE = 60;
const OWNER_ROLE = 100;

export function canViewGroupMembers(roleLevel?: number | null): boolean {
  return roleLevel === OWNER_ROLE || roleLevel === ADMIN_ROLE;
}

export function canViewCircleMembers(role?: 'OWNER' | 'ADMIN' | 'MEMBER' | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
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
}> {
  const currentMember = await params.loadCurrentMember();
  const authorized = canViewGroupMembers(currentMember?.roleLevel);
  return {
    currentMember,
    members: authorized ? await params.loadMembers() : [],
    authorized,
  };
}
