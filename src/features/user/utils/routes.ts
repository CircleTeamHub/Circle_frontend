import type { Href } from 'expo-router';

export type UserProfileScope = 'messages' | 'contacts' | 'profile' | 'discover';

type UserProfileHref = {
  pathname:
    | '/(tabs)/messages/user/[id]'
    | '/(tabs)/contacts/user/[id]'
    | '/(tabs)/profile/user/[id]'
    | '/(tabs)/discover/user/[id]';
  params: { id: string; name?: string };
};

type ChatDetailHref = {
  pathname:
    | '/(tabs)/messages/chat-detail'
    | '/(tabs)/contacts/chat-detail'
    | '/(tabs)/profile/chat-detail'
    | '/(tabs)/discover/chat-detail';
  params: {
    sourceID: string;
    conversationType: 'private' | 'group';
    title?: string;
    avatarUrl?: string;
    conversationID?: string;
    searchedMsgID?: string;
  };
};

export function getUserProfileHref(
  scope: UserProfileScope,
  id: string,
  name?: string,
): UserProfileHref {
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
  fallbackName?: string,
): Href {
  const params = {
    id,
    ...(name ? { name } : {}),
    ...(fallbackName ? { fallbackName } : {}),
  };

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

export function getUserMomentsHref(
  scope: UserProfileScope,
  id: string,
  name?: string,
): Href {
  const params = name ? { id, name } : { id };
  const href = (pathname: string): Href => ({ pathname, params }) as Href;

  switch (scope) {
    case 'contacts':
      return href('/(tabs)/contacts/user/[id]/moments');
    case 'profile':
      return href('/(tabs)/profile/user/[id]/moments');
    case 'discover':
      return href('/(tabs)/discover/user/[id]/moments');
    case 'messages':
    default:
      return href('/(tabs)/messages/user/[id]/moments');
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
  conversationType: 'private' | 'group' = 'private',
): ChatDetailHref {
  // 私聊页在每个 tab 栈下都有 re-export 路由，按来源 scope 入对应栈，
  // 这样返回时回到进入前的上一级，而不是跳到消息首页。
  const params = {
    sourceID,
    conversationType,
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
  section = '',
): Href {
  const params = { id, ownerId, ...(section ? { section } : {}) };

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
  fallbackName?: string,
): Href {
  const params = {
    id,
    ...(name ? { name } : {}),
    ...(conversationID ? { conversationID } : {}),
    ...(fallbackName ? { fallbackName } : {}),
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
      return { pathname: '/(tabs)/contacts/edit-group-notice', params: routeParams } as unknown as Href;
    case 'profile':
      return { pathname: '/(tabs)/profile/edit-group-notice', params: routeParams } as unknown as Href;
    case 'discover':
      return { pathname: '/(tabs)/discover/edit-group-notice', params: routeParams } as unknown as Href;
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/edit-group-notice', params: routeParams } as unknown as Href;
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
      return { pathname: '/(tabs)/contacts/search-group-members', params: routeParams } as unknown as Href;
    case 'profile':
      return { pathname: '/(tabs)/profile/search-group-members', params: routeParams } as unknown as Href;
    case 'discover':
      return { pathname: '/(tabs)/discover/search-group-members', params: routeParams } as unknown as Href;
    case 'messages':
    default:
      return { pathname: '/(tabs)/messages/search-group-members', params: routeParams } as unknown as Href;
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

// ── Circle scope routes ──────────────────────────────────────────────────────
// 圈子详情及其子页镜像在 messages 与 discover 两个栈：聊天里的圈子名片/验证
// 卡必须在本 tab 内打开（从哪进从哪出），不允许跨 tab 压栈把用户扔去动态页。

export type CircleScope = 'messages' | 'discover';

export function getCircleScopeFromSegments(
  segments: readonly string[],
): CircleScope {
  return segments.includes('messages') ? 'messages' : 'discover';
}

export function getCircleDetailHref(scope: CircleScope, circleId: string): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/circle/[id]'
        : '/(tabs)/discover/circle/[id]',
    params: { id: circleId },
  };
}

export function getPlazaPostDetailHref(
  scope: CircleScope,
  postId: string,
): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/plaza-post-detail'
        : '/(tabs)/discover/plaza-post-detail',
    params: { id: postId },
  };
}

export function getCircleEditHref(scope: CircleScope, circleId: string): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/circle/[id]/edit'
        : '/(tabs)/discover/circle/[id]/edit',
    params: { id: circleId },
  };
}

export function getCircleAdminHref(scope: CircleScope, circleId: string): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/circle/[id]/admin'
        : '/(tabs)/discover/circle/[id]/admin',
    params: { id: circleId },
  };
}

export function getCircleInviteHref(
  scope: CircleScope,
  circleId: string,
  title: string,
  avatar: string,
): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/circle/[id]/invite'
        : '/(tabs)/discover/circle/[id]/invite',
    params: { id: circleId, title, avatar },
  };
}

export function getCircleShareHref(
  scope: CircleScope,
  circleId: string,
  title: string,
  avatar: string,
): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/circle/[id]/share'
        : '/(tabs)/discover/circle/[id]/share',
    params: { id: circleId, title, avatar },
  };
}

export function getCircleInviteFriendsHref(
  scope: CircleScope,
  circleId: string,
  title: string,
): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/circle/[id]/invite-friends'
        : '/(tabs)/discover/circle/[id]/invite-friends',
    params: { id: circleId, title },
  };
}

export function getInvitationDetailHref(
  scope: CircleScope,
  invitationId: string,
): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/invitation/[id]'
        : '/(tabs)/discover/invitation/[id]',
    params: { id: invitationId },
  };
}

export function getSelectVerifierHref(
  scope: CircleScope,
  params: { id: string; circleId: string; circleName: string },
): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/invitation/[id]/select-verifier'
        : '/(tabs)/discover/invitation/[id]/select-verifier',
    params,
  };
}

export function getVerificationDetailHref(
  scope: CircleScope,
  invitationId: string,
): Href {
  return {
    pathname:
      scope === 'messages'
        ? '/(tabs)/messages/verification/[id]'
        : '/(tabs)/discover/verification/[id]',
    params: { id: invitationId },
  };
}
