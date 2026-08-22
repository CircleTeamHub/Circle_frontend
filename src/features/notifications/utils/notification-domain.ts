import type { NotificationType } from '@/types';

/**
 * 铃铛的域。两个入口互不越界：
 * - `moments` —— 朋友圈页右上角铃铛：别人对「我」和「我的动态」的互动。
 * - `circle`  —— 广场页右上角铃铛：担保验证 / 入圈审批 / 圈子帖动态。
 *
 * 类型白名单镜像后端 notification.constants.ts 的 MOMENT_/CIRCLE_NOTIFICATION_TYPES。
 * 两边改一边就会出现「服务端算进未读数、客户端不显示」的幽灵红点，务必同改。
 */
export type NotificationDomain = 'moments' | 'circle';

const MOMENT_TYPES: ReadonlySet<string> = new Set([
  'TRACE_LIKE',
  'TRACE_COMMENT',
  'COMMENT_REPLY',
  'TRACE_MENTION',
  'PROFILE_LIKE',
]);

const CIRCLE_TYPES: ReadonlySet<string> = new Set([
  'CIRCLE_VERIFICATION_REQUESTED',
  'CIRCLE_INVITATION_APPROVED',
  'CIRCLE_INVITATION_REJECTED',
  'CIRCLE_ADMIN_OVERRIDE_APPROVED',
  'CIRCLE_POST_PUBLISHED',
  'CIRCLE_POST_AUTO_ENDED',
  'CIRCLE_POST_COLLABORATION_RECOGNIZED',
]);

/** 两个铃铛都会收的类型（并集）—— 好友申请/系统公告等都不在内。 */
export const BELL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  ...MOMENT_TYPES,
  ...CIRCLE_TYPES,
]);

/**
 * 通知归属的域；不属于任何铃铛时返回 null（好友申请走「新的朋友」收件箱，
 * SYSTEM 走「我」页的系统公告）。
 */
export function notificationDomain(
  type: NotificationType | string,
): NotificationDomain | null {
  if (MOMENT_TYPES.has(type)) return 'moments';
  if (CIRCLE_TYPES.has(type)) return 'circle';
  return null;
}

export function isNotificationDomain(
  value: unknown,
): value is NotificationDomain {
  return value === 'moments' || value === 'circle';
}

/** 路由参数 -> 域；非法/缺省值回落到 null（不限域，推送兜底页用）。 */
export function parseNotificationDomain(
  value: unknown,
): NotificationDomain | null {
  return isNotificationDomain(value) ? value : null;
}
