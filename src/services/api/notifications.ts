import { apiClient } from '@/services/api/client';

export type NotificationUnreadSummary = {
  discoverUnread: number;
  profileUnread: number;
  totalUnread: number;
};

export async function fetchNotificationUnreadSummary() {
  return apiClient<NotificationUnreadSummary>('/notification/unread-summary');
}

export async function markProfileNotificationsRead() {
  return apiClient<{ count: number }>('/notification/profile/read-all', {
    method: 'POST',
  });
}
