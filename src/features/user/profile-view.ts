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

export function getFriendActionLabel(status: FriendStatus | null | undefined) {
  switch (status) {
    case 'PENDING_SENT':
      return '已发送申请';
    case 'PENDING_RECEIVED':
      return '等待对方处理';
    case 'ACCEPTED':
      return '已添加';
    case 'BLOCKED':
      return '无法添加';
    case 'NONE':
    default:
      return '添加好友';
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
