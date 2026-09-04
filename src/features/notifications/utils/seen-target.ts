import { markNotificationRead } from '@/services/api/notifications';
import type { NotificationItem } from '@/types';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { reportHandledFailure } from '@/observability/report-failure';

export type NotificationSeenTarget = {
  traceId?: string;
  replyId?: string;
  conversationID?: string;
  sourceID?: string;
  messageID?: string;
  invitationId?: string;
  circlePostId?: string;
  friendRequests?: boolean;
};

function same(left: string | undefined | null, right: string | undefined) {
  return Boolean(left && right && left === right);
}

function messageIdMatches(
  message: NonNullable<NotificationItem['fromMessage']>,
  messageID: string | undefined,
) {
  if (!messageID) return true;
  return (
    same(message.clientMsgID, messageID) ||
    same(message.messageID, messageID) ||
    same(message.id, messageID)
  );
}

export function notificationMatchesSeenTarget(
  notification: Pick<
    NotificationItem,
    | 'type'
    | 'fromTrace'
    | 'fromReply'
    | 'fromMessage'
    | 'fromInvitation'
    | 'fromCirclePost'
  >,
  target: NotificationSeenTarget,
) {
  if (target.friendRequests && notification.type.startsWith('FRIEND_REQUEST')) {
    return true;
  }

  if (target.traceId && same(notification.fromTrace?.id, target.traceId)) {
    return !target.replyId || same(notification.fromReply?.id, target.replyId) || !notification.fromReply?.id;
  }

  if (
    target.invitationId &&
    same(notification.fromInvitation?.id, target.invitationId)
  ) {
    return true;
  }

  if (
    target.circlePostId &&
    same(notification.fromCirclePost?.id, target.circlePostId)
  ) {
    return true;
  }

  const message = notification.fromMessage;
  if (!message || (!target.conversationID && !target.sourceID)) {
    return false;
  }
  const sameConversation =
    same(message.conversationID, target.conversationID) ||
    same(message.sourceID, target.sourceID);
  return sameConversation && messageIdMatches(message, target.messageID);
}

export async function markMatchingTargetNotificationsRead(
  target: NotificationSeenTarget,
) {
  const store = useNotificationCenterStore.getState();
  const unreadMatches = store.interactive.filter(
    (notification) =>
      !notification.read && notificationMatchesSeenTarget(notification, target),
  );

  if (unreadMatches.length === 0) return [];

  for (const notification of unreadMatches) {
    store.markInteractiveReadLocal(notification.id);
  }

  await Promise.all(
    unreadMatches.map((notification) =>
      markNotificationRead(notification.id).catch((error) => {
        reportHandledFailure('notifications', 'markSeenTarget', error);
      }),
    ),
  );

  return unreadMatches.map((notification) => notification.id);
}
