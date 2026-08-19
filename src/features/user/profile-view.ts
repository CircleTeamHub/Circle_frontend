import i18n from '@/i18n';
import type { AuthUser } from '@/stores/authStore';
import type { FriendStatus } from '@/services/api/friends';

type CurrentUserIdentity = Pick<AuthUser, 'id' | 'accountId'> | null | undefined;

type ProfileMetaSource = {
  gender?: string | null;
  city?: string | null;
};

type LoadedProfileIdentity = {
  id: string;
  accountId: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 资料页路由兼容 UUID、账号和靓号，但聊天/通话接口只接受数据库 UUID。
 * 只信与当前路由匹配的已加载资料，避免快速切换资料页时误用上一人的响应。
 */
export function resolveCanonicalProfileUserId(
  routeProfileId: string,
  loadedProfile?: LoadedProfileIdentity | null,
): string | null {
  const routeId = routeProfileId.trim();
  const loadedId = loadedProfile?.id.trim() ?? '';
  const loadedAccountId = loadedProfile?.accountId.trim() ?? '';

  if (
    loadedId &&
    (loadedId === routeId ||
      loadedAccountId.toLowerCase() === routeId.toLowerCase())
  ) {
    return loadedId;
  }

  return UUID_PATTERN.test(routeId) ? routeId : null;
}

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
