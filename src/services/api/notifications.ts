import { apiClient } from '@/services/api/client';
import {
  expectShape,
  isFiniteNonNegativeNumber,
  isPlainObject,
} from '@/utils/validate';
import type { NotificationItem } from '@/types';

export type NotificationUnreadSummary = {
  discoverUnread: number;
  profileUnread: number;
  totalUnread: number;
};

export type PushTokenPlatform = 'ios' | 'android' | 'web';

export type PushTokenProvider = 'expo';

export type RegisterPushTokenInput = {
  token: string;
  platform: PushTokenPlatform;
  provider: PushTokenProvider;
  projectId?: string | null;
  appVersion?: string | null;
};

// 三个未读数都会进 Badge.count 渲染；非数字会让 RN 的 Text 节点抛错。
function isNotificationSummaryShape(
  value: unknown,
): value is NotificationUnreadSummary {
  if (!isPlainObject(value)) return false;
  return (
    isFiniteNonNegativeNumber(value.discoverUnread) &&
    isFiniteNonNegativeNumber(value.profileUnread) &&
    isFiniteNonNegativeNumber(value.totalUnread)
  );
}

export async function fetchNotificationUnreadSummary() {
  const raw = await apiClient<NotificationUnreadSummary>(
    '/notification/unread-summary',
  );
  return expectShape(
    raw,
    isNotificationSummaryShape,
    '通知未读数据格式异常',
  );
}

export async function markProfileNotificationsRead() {
  return apiClient<{ count: number }>('/notification/profile/read-all', {
    method: 'POST',
  });
}

export async function fetchNotifications(
  page = 1,
): Promise<NotificationItem[]> {
  return apiClient<NotificationItem[]>(`/notification/list?page=${page}`);
}

export async function fetchProfileNotifications(
  page = 1,
): Promise<NotificationItem[]> {
  return apiClient<NotificationItem[]>(
    `/notification/profile/list?page=${page}`,
  );
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient<void>(`/notification/${id}/read`, { method: 'PUT' });
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  return apiClient<{ count: number }>('/notification/read-all', {
    method: 'PUT',
  });
}

export async function deleteNotification(id: string): Promise<void> {
  await apiClient<void>(`/notification/${id}`, { method: 'DELETE' });
}

export async function registerPushToken(input: RegisterPushTokenInput): Promise<void> {
  await apiClient<void>('/notification/push-token', {
    method: 'PUT',
    body: input,
  });
}

export async function deletePushToken(
  token: string,
  options: { retryOnAuthError?: boolean } = {},
): Promise<void> {
  await apiClient<void>('/notification/push-token', {
    method: 'DELETE',
    body: { token },
    ...options,
  });
}
