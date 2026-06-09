/**
 * OpenIM v3.8 refuses PostgreSQL UUIDs with dashes as userID values.
 * Keep the conversion helpers in a side-effect-free module so pure helpers do
 * not import the native SDK client and create startup require cycles.
 */
export function toImUserId(userId: string): string {
  return userId.replace(/-/g, '');
}

export function fromImUserId(userId: string): string {
  if (userId.includes('-')) return userId;
  if (userId.length !== 32) return userId;
  return [
    userId.slice(0, 8),
    userId.slice(8, 12),
    userId.slice(12, 16),
    userId.slice(16, 20),
    userId.slice(20),
  ].join('-');
}
