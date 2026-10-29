import type { AvatarFrameAppearance } from '@/types';
import type { AuthUser } from './authStore';

/** Keep active-session and saved-account appearance migration identical. */
export function migratePersistedUser(user: AuthUser): AuthUser {
  const rawUser = user as unknown as Record<string, unknown>;
  const hasAppearance = Object.prototype.hasOwnProperty.call(
    rawUser,
    'avatarFrameAppearance',
  );
  const rawAppearance = rawUser.avatarFrameAppearance;
  const appearanceRecord =
    rawAppearance && typeof rawAppearance === 'object' && !Array.isArray(rawAppearance)
      ? (rawAppearance as Record<string, unknown>)
      : null;
  const parsedAppearance =
    appearanceRecord &&
    typeof appearanceRecord.id === 'string' &&
    typeof appearanceRecord.key === 'string' &&
    typeof appearanceRecord.name === 'string' &&
    (appearanceRecord.imageUrl === null || typeof appearanceRecord.imageUrl === 'string')
      ? ({
          id: appearanceRecord.id,
          key: appearanceRecord.key,
          name: appearanceRecord.name,
          imageUrl: null,
        } as AvatarFrameAppearance)
      : null;
  const vipLevel = typeof rawUser.vipLevel === 'number' ? rawUser.vipLevel : null;
  const avatarFrameAppearance = hasAppearance
    ? parsedAppearance
    : vipLevel === 3
      ? {
          id: 'legacy-membership-diamond',
          key: 'membership-diamond',
          name: 'Diamond membership frame',
          imageUrl: null,
        }
      : vipLevel !== null && vipLevel >= 4
        ? {
            id: 'legacy-membership-super',
            key: 'membership-super',
            name: 'Super membership frame',
            imageUrl: null,
          }
        : null;
  return { ...user, avatarFrame: null, avatarFrameAppearance };
}
