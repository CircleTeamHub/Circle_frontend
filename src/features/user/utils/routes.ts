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
