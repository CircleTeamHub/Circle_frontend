/**
 * Pure route resolution for a snackbar tap. Returns the expo-router target for
 * a given snackbar item, with no side effects, so the decision can be
 * unit-tested independently of navigation.
 */
import type { Href } from 'expo-router';
import type { NotificationSnackbarItem } from '@/features/notifications/store/use-notification-snackbar-store';
import { notificationDomain } from '@/features/notifications/utils/notification-domain';

export type SnackbarRouteOptions = {
  /** Fallback title for an untitled circle post. */
  untitledPost: string;
  /** Tab stack that should own non-chat notification detail routes. */
  scope?: 'messages' | 'discover';
};

const DISCOVER_NOTIFICATION_CENTER_ROUTE =
  '/(tabs)/discover/notification-center' satisfies Href;
const MESSAGES_NOTIFICATION_CENTER_ROUTE =
  '/(tabs)/messages/notifications' satisfies Href;

function getNotificationCenterFallback(
  scope: SnackbarRouteOptions['scope'],
  type: string,
): Href {
  // 拆成两条 return 收敛推断,避免三元合并出巨型 Href 联合触发 TS2590。
  if (scope === 'discover') {
    // 兜底也认域:圈子的通知落在圈子铃铛,朋友圈的落在朋友圈铃铛,
    // 否则点进去看到的是另一个入口的列表。
    const domain = notificationDomain(type);
    if (domain) {
      return {
        pathname: DISCOVER_NOTIFICATION_CENTER_ROUTE,
        params: { domain },
      };
    }
    return DISCOVER_NOTIFICATION_CENTER_ROUTE;
  }
  return MESSAGES_NOTIFICATION_CENTER_ROUTE;
}

export function getSnackbarRoute(
  item: NotificationSnackbarItem,
  options: SnackbarRouteOptions,
): Href {
  if (item.kind === 'chat') {
    return {
      pathname: '/(tabs)/messages/chat-detail',
      params: {
        conversationID: item.conversationID,
        sourceID: item.sourceID,
        title: item.title,
        conversationType: item.conversationType,
        ...(item.avatarUrl ? { avatarUrl: item.avatarUrl } : {}),
        // `item.id` is the triggering message's clientMsgID. Chat detail already
        // scrolls to `searchedMsgID` (shared with in-chat search), so forwarding
        // it lands the user on the exact message instead of the conversation tail.
        ...(item.id ? { searchedMsgID: item.id } : {}),
      },
    };
  }

  if (item.kind === 'notification' && item.fromMessage) {
    const message = item.fromMessage;
    const sourceID = message.sourceID || message.conversationID;
    const searchedMsgID =
      message.clientMsgID || message.messageID || message.id || '';
    if (sourceID) {
      return {
        pathname: '/(tabs)/messages/chat-detail',
        params: {
          ...(message.conversationID
            ? { conversationID: message.conversationID }
            : {}),
          sourceID,
          title: message.title || item.fromUser?.nickname || '',
          conversationType: message.conversationType ?? 'private',
          ...(message.avatarUrl ? { avatarUrl: message.avatarUrl } : {}),
          ...(searchedMsgID ? { searchedMsgID } : {}),
        },
      };
    }
  }

  // 圈子新帖发布 → 直达帖子详情页，方便及时报名（收件人是成员，不能进作者专属的
  // 报名管理页）。
  if (item.type === 'CIRCLE_POST_PUBLISHED' && item.fromCirclePost?.id) {
    return {
      pathname:
        options.scope === 'discover'
          ? '/(tabs)/discover/plaza-post-detail'
          : '/(tabs)/messages/plaza-post-detail',
      params: { id: item.fromCirclePost.id },
    };
  }

  if (
    (item.type === 'CIRCLE_POST_SIGNUP_CREATED' ||
      item.type === 'CIRCLE_POST_AUTO_ENDED') &&
    item.fromCirclePost?.id
  ) {
    return {
      pathname:
        options.scope === 'discover'
          ? '/(tabs)/discover/post-signups'
          : '/(tabs)/messages/post-signups',
      params: {
        postId: item.fromCirclePost.id,
        title: item.fromCirclePost.excerpt || options.untitledPost,
      },
    };
  }

  // 「邀请你为入圈申请验证」→ 直达担保验证页，可直接同意/拒绝。
  if (item.type === 'CIRCLE_VERIFICATION_REQUESTED' && item.fromInvitation?.id) {
    return {
      pathname: '/(tabs)/discover/verification/[id]',
      params: { id: item.fromInvitation.id },
    };
  }

  if (
    (item.type === 'CIRCLE_INVITATION_APPROVED' ||
      item.type === 'CIRCLE_INVITATION_REJECTED' ||
      item.type === 'CIRCLE_ADMIN_OVERRIDE_APPROVED') &&
    item.fromInvitation?.id
  ) {
    return {
      pathname: '/(tabs)/discover/invitation/[id]',
      params: { id: item.fromInvitation.id },
    };
  }

  if (item.type.startsWith('FRIEND_REQUEST')) {
    return '/(tabs)/contacts/new-friends';
  }

  // 资料点赞 / 活动协作认可：直达对方（点赞者 / 认可者）主页，方便回赞 / 加好友。
  if (
    (item.type === 'PROFILE_LIKE' ||
      item.type === 'CIRCLE_POST_COLLABORATION_RECOGNIZED') &&
    item.fromUser?.id
  ) {
    return {
      pathname:
        options.scope === 'discover'
          ? '/(tabs)/discover/user/[id]'
          : '/(tabs)/messages/user/[id]',
      params: { id: item.fromUser.id, name: item.fromUser.nickname },
    };
  }

  if (item.fromTrace?.id) {
    return {
      pathname: '/(tabs)/discover/moment/[id]',
      params: {
        id: item.fromTrace.id,
        ...(item.fromReply?.id ? { targetCommentId: item.fromReply.id } : {}),
      },
    };
  }

  return getNotificationCenterFallback(options.scope, item.type);
}
