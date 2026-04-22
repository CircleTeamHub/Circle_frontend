import i18n from '@/i18n';
import type { AuthUser } from '@/stores/authStore';
import type { FriendStatus } from '@/services/api/friends';

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
    return i18n.t('profileFields.male');
  }

  if (normalized === 'female' || normalized === '女') {
    return i18n.t('profileFields.female');
  }

  if (normalized === 'other' || normalized === '其他') {
    return i18n.t('profileFields.other');
  }

  return i18n.t('profileFields.genderNotSet');
}

export function getProfileMetaItems(profile: ProfileMetaSource) {
  const city = profile.city?.trim() || i18n.t('profileFields.notSet');
  return [formatGenderLabel(profile.gender), city];
}

export function getFriendActionLabel(status: FriendStatus | null | undefined) {
  switch (status) {
    case 'PENDING_SENT':
      return i18n.t('userProfile.friendAction.pendingSent');
    case 'PENDING_RECEIVED':
      return i18n.t('userProfile.friendAction.pendingReceived');
    case 'ACCEPTED':
      return i18n.t('userProfile.friendAction.accepted');
    case 'BLOCKED':
      return i18n.t('userProfile.friendAction.blocked');
    case 'NONE':
    default:
      return i18n.t('userProfile.friendAction.add');
  }
}

type SendFriendRequestAvailabilityInput = {
  isCurrentUser: boolean;
  profileId: string;
  friendStatus: FriendStatus | null | undefined;
  hasProfileLoadError: boolean;
  hasFriendStatusLoadError: boolean;
};

export function canOpenSendFriendRequest(
  input: SendFriendRequestAvailabilityInput,
) {
  return (
    !input.isCurrentUser &&
    input.profileId !== 'unknown' &&
    input.friendStatus === 'NONE' &&
    !input.hasProfileLoadError &&
    !input.hasFriendStatusLoadError
  );
}
