export function canViewCircleMembers(role?: 'OWNER' | 'ADMIN' | 'MEMBER' | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}
