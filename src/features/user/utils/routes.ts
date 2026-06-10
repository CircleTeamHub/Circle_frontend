import type { Href } from 'expo-router';

export type UserProfileScope = 'messages' | 'contacts' | 'profile' | 'discover';

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
    case 'discover':
      return { pathname: '/(tabs)/discover/user/[id]', params };
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
    case 'discover':
      return { pathname: '/(tabs)/discover/user/[id]/request', params };
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
    case 'discover':
      return { pathname: '/(tabs)/discover/user/[id]/remark', params };
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
    case 'discover':
      return { pathname: '/(tabs)/discover/user/[id]/tags', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/user/[id]/tags', params };
  }
}

export function getFriendActivityDetailHref(id: string): Href {
  return { pathname: '/(tabs)/contacts/new-friends/[id]', params: { id } };
}

export function getChatDetailHref(
  scope: UserProfileScope,
  sourceID: string,
  title?: string,
  avatarUrl?: string,
  conversationID?: string,
  searchedMsgID?: string,
): Href {
  // 私聊页在每个 tab 栈下都有 re-export 路由，按来源 scope 入对应栈，
  // 这样返回时回到进入前的上一级，而不是跳到消息首页。
  const params = {
    sourceID,
    conversationType: 'private',
    ...(title ? { title } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(conversationID ? { conversationID } : {}),
    ...(searchedMsgID ? { searchedMsgID } : {}),
  };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/chat-detail', params };
    case 'profile':
      return { pathname: '/(tabs)/profile/chat-detail', params };
    case 'discover':
      return { pathname: '/(tabs)/discover/chat-detail', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/chat-detail', params };
  }
}

export function getNoteDetailHref(
  scope: UserProfileScope,
  id: string,
  ownerId = '',
): Href {
  const params = { id, ownerId };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/notes/[id]', params };
    case 'profile':
      return { pathname: '/(tabs)/profile/notes/[id]', params };
    case 'discover':
      return { pathname: '/(tabs)/discover/notes/[id]', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/notes/[id]', params };
  }
}

/** Tab home route for a scope — used as a back fallback when there's no stack. */
export function getTabHomeHref(scope: UserProfileScope): Href {
  switch (scope) {
    case 'contacts':
      return '/(tabs)/contacts';
    case 'profile':
      return '/(tabs)/profile';
    case 'discover':
      return '/(tabs)/discover';
    case 'messages':
    default:
      return '/(tabs)/messages';
  }
}

/**
 * Top-level (conversation-based) chat-info route per scope. Distinct from
 * getChatInfoHref, which is the friend [id]-based variant. Used by the chat
 * screen so 群信息 stays in the originating tab's stack.
 */
export function getChatInfoTopHref(
  scope: UserProfileScope,
  params: Record<string, string>,
): Href {
  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/chat-info', params };
    case 'profile':
      return { pathname: '/(tabs)/profile/chat-info', params };
    case 'discover':
      return { pathname: '/(tabs)/discover/chat-info', params };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/chat-info', params };
  }
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
    case 'discover':
      return { pathname: '/(tabs)/discover/user/[id]/chat-info', params };
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

export function getEditGroupNoticeHref(
  scope: UserProfileScope,
  params: {
    groupID: string;
    groupTitle?: string;
    notice?: string;
  },
): Href {
  const routeParams = {
    groupID: params.groupID,
    ...(params.groupTitle ? { groupTitle: params.groupTitle } : {}),
    ...(params.notice ? { notice: params.notice } : {}),
  };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/edit-group-notice', params: routeParams };
    case 'profile':
      return { pathname: '/(tabs)/profile/edit-group-notice', params: routeParams };
    case 'discover':
      return { pathname: '/(tabs)/discover/edit-group-notice', params: routeParams };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/edit-group-notice', params: routeParams };
  }
}

export function getGroupMemberSearchHref(
  scope: UserProfileScope,
  params: {
    groupID: string;
    groupTitle?: string;
  },
): Href {
  const routeParams = {
    groupID: params.groupID,
    ...(params.groupTitle ? { groupTitle: params.groupTitle } : {}),
  };

  switch (scope) {
    case 'contacts':
      return { pathname: '/(tabs)/contacts/search-group-members', params: routeParams };
    case 'profile':
      return { pathname: '/(tabs)/profile/search-group-members', params: routeParams };
    case 'discover':
      return { pathname: '/(tabs)/discover/search-group-members', params: routeParams };
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/search-group-members', params: routeParams };
  }
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
  keyword?: string,
): Href {
  return {
    pathname: '/(tabs)/messages/chat-history-text',
    params: {
      ...buildChatHistoryParams(conversationID, sourceID, title),
      ...(keyword ? { keyword } : {}),
    },
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
      segment === 'messages' ||
      segment === 'discover',
  );

  if (
    scope === 'contacts' ||
    scope === 'profile' ||
    scope === 'discover'
  ) {
    return scope;
  }

  return 'messages';
}
