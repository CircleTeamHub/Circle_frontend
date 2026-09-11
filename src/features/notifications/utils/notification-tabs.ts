import type { NotificationDomain } from './notification-domain';

/**
 * 通知中心两个 tab 的排列顺序：
 * - 圈子铃铛（`circle`）把「报名管理」排在前面——圈主进来最常处理的就是报名；
 * - 推送兜底页（不限域，`null`）保持「通知」在前。
 *
 * 只负责顺序：报名 tab 是否显示由页面按域决定（朋友圈铃铛没有它），
 * 默认选中项也不跟着顺序走（圈子域仍落在「圈子动态」上，见 #238）。
 */
export function orderNotificationTabs<T>(
  domain: NotificationDomain | null,
  tabs: { readonly notifications: T; readonly signups: T },
): T[] {
  return domain === 'circle'
    ? [tabs.signups, tabs.notifications]
    : [tabs.notifications, tabs.signups];
}
