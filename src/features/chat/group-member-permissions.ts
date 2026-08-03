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
