import i18n from '@/i18n';
import type { FriendActivity } from '@/services/api/friends';

export type FriendActivityInboxRow = {
  activity: FriendActivity;
  unreadActivityIds: string[];
};

function getCounterpartyName(activity: Pick<FriendActivity, 'counterparty'>) {
  return (
    activity.counterparty.nickname?.trim() || activity.counterparty.accountId
  );
}

export function getFriendActivityCopy(
  activity: Pick<FriendActivity, 'type' | 'counterparty'>,
) {
  const name = getCounterpartyName(activity);

  switch (activity.type) {
    case 'REQUEST_RECEIVED':
      return i18n.t('contacts.friendActivity.copy.requestReceived', { name });
    case 'REQUEST_SENT':
      return i18n.t('contacts.friendActivity.copy.requestSent', { name });
    case 'REQUEST_ACCEPTED_BY_OTHER':
      return i18n.t('contacts.friendActivity.copy.requestAcceptedByOther', { name });
    case 'REQUEST_REJECTED_BY_OTHER':
      return i18n.t('contacts.friendActivity.copy.requestRejectedByOther', { name });
    case 'REQUEST_ACCEPTED_BY_ME':
      return i18n.t('contacts.friendActivity.copy.requestAcceptedByMe', { name });
    case 'REQUEST_REJECTED_BY_ME':
      return i18n.t('contacts.friendActivity.copy.requestRejectedByMe', { name });
    case 'REQUEST_WITHDRAWN_BY_OTHER':
      return i18n.t('contacts.friendActivity.copy.requestWithdrawnByOther', { name });
    default:
      return i18n.t('contacts.friendActivity.copy.default', { name });
  }
}

export function hasUnreadFriendActivities(count: number) {
  return count > 0;
}

export function getFriendActivityDisplayName(
  activity: Pick<FriendActivity, 'counterparty'>,
) {
  return getCounterpartyName(activity);
}

export function buildFriendActivityInboxRows(
  activities: FriendActivity[],
): FriendActivityInboxRow[] {
  const groups = new Map<string, FriendActivityInboxRow>();

  for (const activity of activities) {
    const key = activity.counterparty.id || activity.counterparty.accountId;
    const current = groups.get(key);

    if (!current) {
      groups.set(key, {
        activity,
        unreadActivityIds: activity.readAt ? [] : [activity.id],
      });
      continue;
    }

    if (!activity.readAt) {
      current.unreadActivityIds.push(activity.id);
    }

    if (new Date(activity.createdAt).getTime() > new Date(current.activity.createdAt).getTime()) {
      current.activity = activity;
    }
  }

  return Array.from(groups.values()).sort(
    (left, right) =>
      new Date(right.activity.createdAt).getTime() -
      new Date(left.activity.createdAt).getTime(),
  );
}

export function canHandleFriendActivity(
  activity: Pick<FriendActivity, 'type' | 'requestState'>,
) {
  return activity.type === 'REQUEST_RECEIVED' && activity.requestState === 'PENDING';
}
