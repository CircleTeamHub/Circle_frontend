export interface NotificationListItem {
  id: string;
  name: string;
  avatarUrl?: string;
  actionText: string;
  target: string;
  time: string;
  unread: boolean;
}

export interface NotificationCategory {
  id: 'likes' | 'follows' | 'comments';
  title: string;
  icon: string;
  backgroundColor: string;
  iconColor: string;
  route:
    | '/(tabs)/messages/notifications-likes'
    | '/(tabs)/messages/notifications-follows'
    | '/(tabs)/messages/notifications-comments';
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    id: 'likes',
    title: '赞和收藏',
    icon: 'heart',
    backgroundColor: 'rgba(255, 107, 107, 0.14)',
    iconColor: '#FF7E79',
    route: '/(tabs)/messages/notifications-likes',
  },
  {
    id: 'follows',
    title: '新增关注',
    icon: 'person',
    backgroundColor: 'rgba(87, 140, 255, 0.16)',
    iconColor: '#5B95FF',
    route: '/(tabs)/messages/notifications-follows',
  },
  {
    id: 'comments',
    title: '评论和 @',
    icon: 'chatbubble-ellipses',
    backgroundColor: 'rgba(86, 220, 169, 0.14)',
    iconColor: '#59D9A7',
    route: '/(tabs)/messages/notifications-comments',
  },
];

export const LIKE_AND_FAVORITE_NOTIFICATIONS: NotificationListItem[] = [
  {
    id: 'like-1',
    name: '李晓婷',
    actionText: '赞了你的动态',
    target: '发现一家超赞的日式拉面馆！',
    time: '2分钟前',
    unread: true,
  },
  {
    id: 'like-2',
    name: '周子涵',
    actionText: '收藏了你的动态',
    target: '周末一起去天台酒吧吗？',
    time: '18分钟前',
    unread: true,
  },
  {
    id: 'like-3',
    name: '王浩然',
    actionText: '赞了你的动态',
    target: '会议改到下午 3 点了',
    time: '昨天 20:18',
    unread: false,
  },
];

export const FOLLOW_NOTIFICATIONS: NotificationListItem[] = [
  {
    id: 'follow-1',
    name: '陈思琪',
    actionText: '关注了你',
    target: '你们有 4 位共同好友',
    time: '5分钟前',
    unread: true,
  },
  {
    id: 'follow-2',
    name: '赵天宇',
    actionText: '关注了你',
    target: '最近来自同城推荐',
    time: '昨天 11:06',
    unread: false,
  },
];

export const COMMENT_AND_MENTION_NOTIFICATIONS: NotificationListItem[] = [
  {
    id: 'comment-1',
    name: '陈思琪',
    actionText: '评论了你的动态',
    target: '太棒了，下次一起去！',
    time: '15分钟前',
    unread: true,
  },
  {
    id: 'comment-2',
    name: '林美琪',
    actionText: '@了你',
    target: '你看看这个地方怎么样？',
    time: '1小时前',
    unread: true,
  },
  {
    id: 'comment-3',
    name: '吴佳怡',
    actionText: '评论了你的动态',
    target: '这家店我也很喜欢',
    time: '昨天 12:42',
    unread: false,
  },
];

export const LATEST_NOTIFICATIONS: NotificationListItem[] = [
  COMMENT_AND_MENTION_NOTIFICATIONS[0],
  LIKE_AND_FAVORITE_NOTIFICATIONS[0],
  FOLLOW_NOTIFICATIONS[0],
];

export const NOTIFICATIONS_BY_CATEGORY: Record<
  NotificationCategory['id'],
  NotificationListItem[]
> = {
  likes: LIKE_AND_FAVORITE_NOTIFICATIONS,
  follows: FOLLOW_NOTIFICATIONS,
  comments: COMMENT_AND_MENTION_NOTIFICATIONS,
};

export function getUnreadNotificationsByCategory(
  categoryId: NotificationCategory['id'],
) {
  return NOTIFICATIONS_BY_CATEGORY[categoryId].filter((item) => item.unread);
}

export function getUnreadNotificationCountByCategory(
  categoryId: NotificationCategory['id'],
) {
  return getUnreadNotificationsByCategory(categoryId).length;
}

export function getTotalUnreadNotificationCount() {
  return NOTIFICATION_CATEGORIES.reduce(
    (total, category) => total + getUnreadNotificationCountByCategory(category.id),
    0,
  );
}
