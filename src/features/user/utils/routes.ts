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

export function getChatDetailHref(
  sourceID: string,
  title?: string,
  avatarUrl?: string,
  conversationID?: string,
  searchedMsgID?: string,
): Href {
  return {
    pathname: '/(tabs)/messages/chat-detail',
    params: {
      sourceID,
      conversationType: 'private',
      ...(title ? { title } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(conversationID ? { conversationID } : {}),
      ...(searchedMsgID ? { searchedMsgID } : {}),
    },
  };
}

export function getChatInfoHref(
  scope: UserProfileScope,
  id: string,
  name?: string,
  conversationID?: string,
): Href {
  const params = {
    id,
    ...(name ? { name } : {}),
    ...(conversationID ? { conversationID } : {}),
    originScope: scope,
  };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/user/[id]/chat-info', params };
    case 'profile':
      return { pathname: '/(tabs)/profile/user/[id]/chat-info', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/chat-info', params };
  }
}

export function getChatBackgroundHref(
  conversationID: string,
  sourceID?: string,
  title?: string,
): Href {
  return {
    pathname: '/(tabs)/messages/chat-background',
    params: {
      conversationID,
      ...(sourceID ? { sourceID } : {}),
      ...(title ? { title } : {}),
    },
  };
}

export function getRecommendFriendHref(
  conversationID: string,
  friendId: string,
  friendName?: string,
): Href {
  return {
    pathname: '/(tabs)/messages/recommend-friend',
    params: {
      conversationID,
      friendId,
      ...(friendName ? { friendName } : {}),
    },
  };
}

function buildChatHistoryParams(
  conversationID: string,
  sourceID?: string,
  title?: string,
) {
  return {
    conversationID,
    ...(sourceID ? { sourceID } : {}),
    ...(title ? { title } : {}),
  };
}

export function getChatHistorySearchHubHref(
  conversationID: string,
  sourceID?: string,
  title?: string,
): Href {
  return {
    pathname: '/(tabs)/messages/chat-history-search',
    params: buildChatHistoryParams(conversationID, sourceID, title),
  };
}

export function getChatHistoryTextHref(
  conversationID: string,
  sourceID?: string,
  title?: string,
): Href {
  return {
    pathname: '/(tabs)/messages/chat-history-text',
    params: buildChatHistoryParams(conversationID, sourceID, title),
  };
}

export function getChatHistoryMediaHref(
  conversationID: string,
  sourceID?: string,
  title?: string,
): Href {
  return {
    pathname: '/(tabs)/messages/chat-history-media',
    params: buildChatHistoryParams(conversationID, sourceID, title),
  };
}

export function getChatHistoryFilesHref(
  conversationID: string,
  sourceID?: string,
  title?: string,
): Href {
  return {
    pathname: '/(tabs)/messages/chat-history-files',
    params: buildChatHistoryParams(conversationID, sourceID, title),
  };
}

export function getChatHistoryDateHref(
  conversationID: string,
  sourceID?: string,
  title?: string,
): Href {
  return {
    pathname: '/(tabs)/messages/chat-history-date',
    params: buildChatHistoryParams(conversationID, sourceID, title),
  };
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
