import type { Href } from 'expo-router';

export type UserProfileScope = 'messages' | 'contacts' | 'profile';

export function getUserProfileHref(
  scope: UserProfileScope,
  id: string,
  name?: string,
): Href {
  const params = name ? { id, name } : { id };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/user/[id]', params };
    case 'profile':
      return { pathname: '/(tabs)/profile/user/[id]', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/user/[id]', params };
  }
}

export function getSendFriendRequestHref(
  scope: UserProfileScope,
  id: string,
  name?: string,
): Href {
  const params = name ? { id, name } : { id };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/user/[id]/request', params };
    case 'profile':
      return { pathname: '/(tabs)/profile/user/[id]/request', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/user/[id]/request', params };
  }
}

export function getEditFriendRemarkHref(
  scope: UserProfileScope,
  id: string,
  name?: string,
): Href {
  const params = name ? { id, name } : { id };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/user/[id]/remark', params };
    case 'profile':
      return { pathname: '/(tabs)/profile/user/[id]/remark', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/user/[id]/remark', params };
  }
}

export function getEditFriendTagsHref(
  scope: UserProfileScope,
  id: string,
  name?: string,
): Href {
  const params = name ? { id, name } : { id };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/user/[id]/tags', params };
    case 'profile':
      return { pathname: '/(tabs)/profile/user/[id]/tags', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/user/[id]/tags', params };
  }
}

export function getFriendActivityDetailHref(id: string): Href {
  return { pathname: '/(tabs)/contacts/new-friends/[id]', params: { id } };
}

export function getUserProfileScopeFromSegments(
  segments: readonly string[] | undefined,
): UserProfileScope {
  const scope = segments?.find(
    (segment) =>
      segment === 'contacts' ||
      segment === 'profile' ||
      segment === 'messages',
  );

  if (scope === 'contacts' || scope === 'profile') {
    return scope;
  }

  return 'messages';
}
