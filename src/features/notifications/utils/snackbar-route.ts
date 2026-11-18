/**
 * Pure route resolution for a snackbar tap. Returns the expo-router target for
 * a given snackbar item, with no side effects, so the decision can be
 * unit-tested independently of navigation.
 */
import { getGroupEntryHref } from '@/features/groups/routes';
import type { Href } from 'expo-router';
import type { NotificationSnackbarItem } from '@/features/notifications/store/use-notification-snackbar-store';
import { notificationDomain } from '@/features/notifications/utils/notification-domain';
import {
  getMomentDetailHref,
  getNewFriendsHref,
  getNotificationCenterHref,
  type UserProfileScope,
} from '@/features/user/utils/routes';

export type SnackbarRouteOptions = {
  /** Fallback title for an untitled circle post. */
  untitledPost: string;
  /**
   * 点通知时所在的 tab 栈。详情页每个栈都有一份,留在本栈打开,返回才回到点进来的地方
   * (横幅下面的页面 / 通知列表)。
   */
  scope: UserProfileScope;
};

function getNotificationCenterFallback(scope: UserProfileScope, type: string): Href {
  // 兜底也认域:圈子的通知落在圈子铃铛,朋友圈的落在朋友圈铃铛,否则点进去看到的是
  // 另一个入口的列表。群聊知会 / 公告不属于这两个铃铛,按不限域兜底;消息页的「通知」不分域。
  const domain = notificationDomain(type);
  const bell = scope !== 'messages' && (domain === 'moments' || domain === 'circle') ? domain : undefined;
  return getNotificationCenterHref(scope, bell);
}

export function getSnackbarRoute(
  item: NotificationSnackbarItem,
  options: SnackbarRouteOptions,
): Href {
  const { scope } = options;
  if (item.kind === 'notification' && item.fromGroupAdmission?.id) return getGroupEntryHref(scope, { admissionId: item.fromGroupAdmission.id });
  if (item.kind === 'chat') {
    return {
      pathname: `/(tabs)/${scope}/chat-detail`,
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
        pathname: `/(tabs)/${scope}/chat-detail`,
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

  if (
    (item.type === 'CIRCLE_POST_SIGNUP_CREATED' ||
      item.type === 'CIRCLE_POST_AUTO_ENDED') &&
    item.fromCirclePost?.id
  ) {
    return {
      pathname: `/(tabs)/${scope}/post-signups`,
      params: {
        postId: item.fromCirclePost.id,
        title: item.fromCirclePost.excerpt || options.untitledPost,
      },
    };
  }

  // 「邀请你为入圈申请验证」→ 直达担保验证页，可直接同意/拒绝。
  if (item.type === 'CIRCLE_VERIFICATION_REQUESTED' && item.fromInvitation?.id) {
    return { pathname: `/(tabs)/${scope}/verification/[id]`, params: { id: item.fromInvitation.id } };
  }

  if (
    (item.type === 'CIRCLE_INVITATION_RECEIVED' || item.type === 'CIRCLE_INVITATION_APPROVED' ||
      item.type === 'CIRCLE_INVITATION_REJECTED' ||
      item.type === 'CIRCLE_ADMIN_OVERRIDE_APPROVED') &&
    item.fromInvitation?.id
  ) {
    return { pathname: `/(tabs)/${scope}/invitation/[id]`, params: { id: item.fromInvitation.id } };
  }

  if (item.type.startsWith('FRIEND_REQUEST')) {
    return getNewFriendsHref(scope);
  }

  // 系统公告(公告不弹横幅,只从通知列表点进来):详情页按通知 id 取。
  if (item.kind === 'notification' && item.type === 'SYSTEM') {
    return { pathname: `/(tabs)/${scope}/system-announcements/[id]`, params: { id: item.id } };
  }

  // 资料点赞 / 活动协作认可：直达对方（点赞者 / 认可者）主页，方便回赞 / 加好友。
  if (
    (item.type === 'PROFILE_LIKE' ||
      item.type === 'CIRCLE_POST_COLLABORATION_RECOGNIZED') &&
    item.fromUser?.id
  ) {
    return {
      pathname: `/(tabs)/${scope}/user/[id]`,
      params: { id: item.fromUser.id, name: item.fromUser.nickname },
    };
  }

  if (item.fromTrace?.id) {
    return getMomentDetailHref(scope, item.fromTrace.id, item.fromReply?.id);
  }

  return getNotificationCenterFallback(scope, item.type);
}

export function isUserProfileSnackbarRoute(route: Href): boolean {
  if (typeof route !== 'object' || route === null || !('pathname' in route)) {
    return false;
  }
  return (
    typeof route.pathname === 'string' &&
    route.pathname.endsWith('/user/[id]')
  );
}
