import React from 'react';
import { NotificationList } from '@/features/messages/components/NotificationList';
import { LIKE_AND_FAVORITE_NOTIFICATIONS } from '@/features/messages/data/notifications';

export default function NotificationsLikesScreen() {
  return (
    <NotificationList
      title="赞和收藏"
      subtitle="查看谁赞了你、收藏了你的动态"
      items={LIKE_AND_FAVORITE_NOTIFICATIONS}
    />
  );
}
