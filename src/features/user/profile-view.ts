import type { AuthUser } from '@/stores/authStore';

type CurrentUserIdentity = Pick<AuthUser, 'id' | 'accountId'> | null | undefined;

type ProfileMetaSource = {
  gender?: string | null;
  city?: string | null;
};

export function isCurrentUserProfile(
  profileId: string,
  currentUser: CurrentUserIdentity,
) {
  if (!currentUser) {
    return profileId === 'me';
  }

  return (
    profileId === 'me' ||
    profileId === currentUser.id ||
    profileId === currentUser.accountId
  );
}

export function formatGenderLabel(gender?: string | null) {
  const normalized = gender?.trim().toLowerCase();

  if (normalized === 'male' || normalized === '男') {
    return '男';
  }

  if (normalized === 'female' || normalized === '女') {
    return '女';
  }

  if (normalized === 'other' || normalized === '其他') {
    return '其他';
  }

  return '未设置';
}

export function getProfileMetaItems(profile: ProfileMetaSource) {
  const city = profile.city?.trim() || '未设置';
  return [formatGenderLabel(profile.gender), city];
}
