import { markNotificationRead, markTraceLikesRead } from '@/services/api/notifications';
import type { NotificationItem } from '@/types';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { useAuthStore } from '@/stores/authStore';

const pendingTraceLikeReads = new Map<string, Promise<void>>();

export function markTraceLikeNotificationsRead(traceId: string): Promise<void> {
  const { user, sessionEpoch, isAuthenticated } = useAuthStore.getState();
  if (!isAuthenticated || !user?.id) return Promise.resolve();
  const key = `${sessionEpoch}:${user.id}:${traceId}`;
  const pending = pendingTraceLikeReads.get(key);
  if (pending) return pending;

  const store = useNotificationCenterStore.getState();
  const unread = store.interactive.filter((item) =>
    !item.read && item.type === 'TRACE_LIKE' && item.fromTrace?.id === traceId,
  );
  const work = markTraceLikesRead(traceId).then(() => {
    const auth = useAuthStore.getState();
    if (auth.sessionEpoch !== sessionEpoch || auth.user?.id !== user.id) return;
    // The server broadcasts the authoritative badge counts, including unloaded likes.
    for (const item of unread) store.markInteractiveReadLocal(item.id);
  }).catch((error: unknown) => {
    reportHandledFailure('notifications', 'markTraceLikesRead', error);
  }).finally(() => pendingTraceLikeReads.delete(key));
  pendingTraceLikeReads.set(key, work);
  return work;
}

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

  const individual = target.traceId
    ? unreadMatches.filter((notification) => notification.type !== 'TRACE_LIKE')
    : unreadMatches;
  for (const notification of individual) {
    store.markInteractiveReadLocal(notification.id);
  }

  await Promise.all([
    ...(target.traceId && individual.length < unreadMatches.length
      ? [markTraceLikeNotificationsRead(target.traceId)] : []),
    ...individual.map((notification) =>
      markNotificationRead(notification.id).catch((error) => {
        reportHandledFailure('notifications', 'markSeenTarget', error);
      }),
    ),
  ]);

  return unreadMatches.map((notification) => notification.id);
}
