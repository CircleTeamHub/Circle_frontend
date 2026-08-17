import { apiClient } from '@/services/api/client';
import {
  expectShape,
  isFiniteNonNegativeNumber,
  isPlainObject,
} from '@/utils/validate';
import type { NotificationItem } from '@/types';
import type { NotificationDomain } from '@/features/notifications/utils/notification-domain';

export type NotificationUnreadSummary = {
  discoverUnread: number;
  /** 朋友圈铃铛未读。老后端不返回该字段 —— 见下面的形状校验。 */
  momentsUnread: number;
  /** 圈子铃铛未读（不含报名管理）。 */
  circleUnread: number;
  profileUnread: number;
  totalUnread: number;
};

export type PushTokenPlatform = 'ios' | 'android' | 'web';

export type PushTokenProvider = 'expo';

export type RegisterPushTokenInput = {
  token: string;
  platform: PushTokenPlatform;
  provider: PushTokenProvider;
  revocationSecret: string;
  projectId?: string | null;
  appVersion?: string | null;
};

// 未读数都会进 Badge.count 渲染；非数字会让 RN 的 Text 节点抛错。
// momentsUnread / circleUnread 是后来加的：字段缺失（老后端）时按 0 补齐而不是
// 判定整个响应非法，否则新客户端连老服务端会整块丢掉徽标。
function isNotificationSummaryShape(
  value: unknown,
): value is Omit<NotificationUnreadSummary, 'momentsUnread' | 'circleUnread'> {
  if (!isPlainObject(value)) return false;
  return (
    isFiniteNonNegativeNumber(value.discoverUnread) &&
    isFiniteNonNegativeNumber(value.profileUnread) &&
    isFiniteNonNegativeNumber(value.totalUnread)
  );
}

function optionalUnreadCount(value: unknown): number {
  return isFiniteNonNegativeNumber(value) ? value : 0;
}

function isNotificationOpenOwnershipShape(
  value: unknown,
): value is { owned: boolean } {
  return isPlainObject(value) && typeof value.owned === 'boolean';
}

export async function fetchNotificationUnreadSummary(): Promise<NotificationUnreadSummary> {
  const raw = await apiClient<NotificationUnreadSummary>(
    '/notification/unread-summary',
  );
  const summary = expectShape(
    raw,
    isNotificationSummaryShape,
    '通知未读数据格式异常',
  );
  const source = raw as Partial<NotificationUnreadSummary>;
  return {
    ...summary,
    momentsUnread: optionalUnreadCount(source.momentsUnread),
    circleUnread: optionalUnreadCount(source.circleUnread),
  };
}

export async function markProfileNotificationsRead() {
  return apiClient<{ count: number }>('/notification/profile/read-all', {
    method: 'POST',
  });
}

// domain 省略时拉互动域全集（推送兜底页仍需要）；带上时只拉那一个铃铛的类型。
export async function fetchNotifications(
  page = 1,
  domain?: NotificationDomain | null,
): Promise<NotificationItem[]> {
  const query = domain ? `?page=${page}&domain=${domain}` : `?page=${page}`;
  return apiClient<NotificationItem[]>(`/notification/list${query}`);
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

export async function verifyNotificationOpenOwnership(
  id: string,
): Promise<{ owned: boolean }> {
  const raw = await apiClient<{ owned: boolean }>(
    `/notification/${id}/open-ownership`,
  );
  return expectShape(
    raw,
    isNotificationOpenOwnershipShape,
    '通知归属数据格式异常',
  );
}

// 「全部已读」必须带域，否则朋友圈铃铛的一次点击会把圈子未读也清空。
export async function markAllNotificationsRead(
  domain?: NotificationDomain | null,
): Promise<{ count: number }> {
  const query = domain ? `?domain=${domain}` : '';
  return apiClient<{ count: number }>(`/notification/read-all${query}`, {
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

export async function revokePushToken(
  token: string,
  revocationSecret: string,
): Promise<void> {
  await apiClient<void>('/notification/push-token/revoke', {
    method: 'DELETE',
    body: { token, revocationSecret },
    auth: false,
    retryOnAuthError: false,
  });
}

export async function deleteLegacyPushToken(
  token: string,
  options: { accessToken: string },
): Promise<void> {
  await apiClient<void>('/notification/push-token', {
    method: 'DELETE',
    body: { token },
    retryOnAuthError: false,
    accessToken: options.accessToken,
  });
}
