import React from 'react';
import { NotificationList } from '@/features/messages/components/NotificationList';
import { COMMENT_AND_MENTION_NOTIFICATIONS } from '@/features/messages/data/notifications';

export default function NotificationsCommentsScreen() {
  return (
    <NotificationList
      title="评论和 @"
      subtitle="查看评论和提到你的互动消息"
      items={COMMENT_AND_MENTION_NOTIFICATIONS}
    />
  );
}
