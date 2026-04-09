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
      return `${name} 请求添加你为好友`;
    case 'REQUEST_SENT':
      return `你已向 ${name} 发送好友申请`;
    case 'REQUEST_ACCEPTED_BY_OTHER':
      return `${name} 通过了你的好友申请`;
    case 'REQUEST_REJECTED_BY_OTHER':
      return `${name} 拒绝了你的好友申请`;
    case 'REQUEST_ACCEPTED_BY_ME':
      return `你已通过 ${name} 的好友申请`;
    case 'REQUEST_REJECTED_BY_ME':
      return `你已拒绝 ${name} 的好友申请`;
    case 'REQUEST_WITHDRAWN_BY_OTHER':
      return `${name} 撤回了好友申请`;
    default:
      return `${name} 有新的好友动态`;
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
