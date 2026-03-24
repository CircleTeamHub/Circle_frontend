import React from 'react';
import { NotificationList } from '@/features/messages/components/NotificationList';
import { FOLLOW_NOTIFICATIONS } from '@/features/messages/data/notifications';

export default function NotificationsFollowsScreen() {
  return (
    <NotificationList
      title="新增关注"
      subtitle="查看最近新增的关注提醒"
      items={FOLLOW_NOTIFICATIONS}
    />
  );
}
