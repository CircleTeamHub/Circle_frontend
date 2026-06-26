/**
 * Pure route resolution for a snackbar tap. Returns the expo-router target for
 * a given snackbar item, with no side effects, so the decision can be
 * unit-tested independently of navigation.
 */
import type { Href } from 'expo-router';
import type { NotificationSnackbarItem } from '@/features/notifications/store/use-notification-snackbar-store';

export type SnackbarRouteOptions = {
  /** Fallback title for an untitled circle post. */
  untitledPost: string;
};

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

  if (item.type === 'CIRCLE_POST_SIGNUP_CREATED' && item.fromCirclePost?.id) {
    return {
      pathname: '/(tabs)/messages/post-signups',
      params: {
        postId: item.fromCirclePost.id,
        title: item.fromCirclePost.excerpt || options.untitledPost,
      },
    };
  }

  if (item.type.startsWith('FRIEND_REQUEST')) {
    return '/(tabs)/contacts/new-friends';
  }

  if (item.fromTrace?.id) {
    return {
      pathname: '/(tabs)/discover/moment/[id]',
      params: { id: item.fromTrace.id },
    };
  }

  return '/(tabs)/messages/notifications';
}
