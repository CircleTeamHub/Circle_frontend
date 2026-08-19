import type { Href } from 'expo-router';

type PushData = Record<string, unknown>;

function text(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function firstText(data: PushData, keys: string[]) {
  for (const key of keys) {
    const value = text(data[key]);
    if (value) return value;
  }
  return '';
}

const MESSAGE_NOTIFICATION_TYPES = new Set([
  'MESSAGE_RECEIVED',
  'MEMBER_MENTION',
  'MESSAGE_QUOTE',
]);

const FRIEND_NOTIFICATION_TYPES = new Set([
  'FRIEND_REQUEST_RECEIVED',
  'FRIEND_REQUEST_ACCEPTED',
  'FRIEND_REQUEST_REJECTED',
  'FRIEND_REQUEST_MESSAGE',
]);

const VERIFICATION_NOTIFICATION_TYPES = new Set([
  'CIRCLE_VERIFICATION_REQUESTED',
]);

const INVITATION_NOTIFICATION_TYPES = new Set([
  'CIRCLE_INVITATION_APPROVED',
  'CIRCLE_INVITATION_REJECTED',
  'CIRCLE_ADMIN_OVERRIDE_APPROVED',
]);

const CIRCLE_POST_NOTIFICATION_TYPES = new Set([
  'CIRCLE_POST_SIGNUP_CREATED',
  'CIRCLE_POST_AUTO_ENDED',
]);

export function resolvePushNotificationRoute(data: PushData): Href | null {
  const route = firstText(data, ['route', 'screen', 'target']).toLowerCase();
  const type = firstText(data, ['type', 'notificationType']).toUpperCase();
  const traceId = firstText(data, ['traceId', 'traceID', 'momentId', 'momentID']);
  const replyId = firstText(data, ['replyId', 'replyID', 'commentId', 'commentID']);
  const invitationId = firstText(data, ['invitationId', 'invitationID']);
  const postId = firstText(data, ['postId', 'postID', 'circlePostId', 'circlePostID']);

  if (route === 'home') {
    return '/(tabs)/messages';
  }

  if (route === 'system' || type === 'SYSTEM') {
    return '/(tabs)/profile/system-announcements';
  }

  if (route === 'friend' || FRIEND_NOTIFICATION_TYPES.has(type)) {
    return '/(tabs)/contacts/new-friends';
  }

  if (
    invitationId &&
    (route === 'verification' ||
      route === 'circle_verification' ||
      VERIFICATION_NOTIFICATION_TYPES.has(type))
  ) {
    return {
      pathname: '/(tabs)/discover/verification/[id]',
      params: { id: invitationId },
    };
  }

  if (
    invitationId &&
    (route === 'invitation' ||
      route === 'circle_invitation' ||
      INVITATION_NOTIFICATION_TYPES.has(type))
  ) {
    return {
      pathname: '/(tabs)/discover/invitation/[id]',
      params: { id: invitationId },
    };
  }

  // 圈子新帖发布 → 帖子详情页，方便及时报名（成员视角，非作者报名管理页）。
  if (
    postId &&
    (route === 'plaza-post' || type === 'CIRCLE_POST_PUBLISHED')
  ) {
    return {
      pathname: '/(tabs)/messages/plaza-post-detail',
      params: { id: postId },
    };
  }

  if (
    postId &&
    (route === 'post-signups' ||
      route === 'circle_post' ||
      CIRCLE_POST_NOTIFICATION_TYPES.has(type))
  ) {
    return {
      pathname: '/(tabs)/messages/post-signups',
      params: {
        postId,
        title: firstText(data, ['title', 'postTitle']),
      },
    };
  }

  if (type === 'PROFILE_LIKE' || type === 'CIRCLE_POST_COLLABORATION_RECOGNIZED') {
    const fromUserId = firstText(data, ['fromUserId', 'fromUserID']);
    if (!fromUserId) return '/(tabs)/messages/notifications';
    return {
      pathname: '/(tabs)/messages/user/[id]',
      params: {
        id: fromUserId,
        name: firstText(data, ['fromUserNickname', 'fromUserName']),
      },
    };
  }

  if (traceId && (route === 'trace' || route === 'moment' || route === '')) {
    return {
      pathname: '/(tabs)/discover/moment/[id]',
      params: {
        id: traceId,
        ...(replyId ? { targetCommentId: replyId } : {}),
      },
    };
  }

  const conversationID = firstText(data, ['conversationID', 'conversationId']);
  const sourceID = firstText(data, ['sourceID', 'sourceId', 'squadID', 'squadId', 'groupID', 'groupId']);
  if (
    conversationID ||
    sourceID ||
    route === 'chat' ||
    route === 'message' ||
    route === 'conversation' ||
    MESSAGE_NOTIFICATION_TYPES.has(type)
  ) {
    const resolvedSourceID = sourceID || conversationID;
    if (!resolvedSourceID) return null;
    const conversationType =
      firstText(data, ['conversationType']) ||
      (route === 'squad' ||
      data.squadID ||
      data.squadId ||
      data.groupID ||
      data.groupId ||
      type === 'MEMBER_MENTION'
        ? 'group'
        : 'private');
    const conversationKind = firstText(data, ['conversationKind']);
    const searchedMsgID = firstText(data, [
      'searchedMsgID',
      'clientMsgID',
      'clientMsgId',
      'messageID',
      'messageId',
    ]);

    return {
      pathname: '/(tabs)/messages/chat-detail',
      params: {
        ...(conversationID ? { conversationID } : {}),
        sourceID: resolvedSourceID,
        conversationType,
        ...(conversationKind ? { conversationKind } : {}),
        ...(firstText(data, ['title', 'name']) ? { title: firstText(data, ['title', 'name']) } : {}),
        ...(searchedMsgID ? { searchedMsgID } : {}),
      },
    };
  }

  return null;
}
