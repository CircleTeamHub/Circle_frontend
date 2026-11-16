import type { NotificationType } from '@/types';

/**
 * 通知入口的域。入口互不越界：
 * - `moments` —— 朋友圈页右上角铃铛：别人对「我」和「我的动态」的互动。
 * - `circle`  —— 广场页铃铛 / 消息页飞机：圈子的事一律在这里（担保验证、入圈审批、
 *   收到圈子邀请、活动结束与认可、被移出圈子、圈子解散）。
 * - `notice`  —— 消息页列表里的「通知」：圈子以外的知会，分三类 ——
 *   `moments`（互动）、`group`（被移出独立群聊 / 群聊解散）、`system`（系统公告）。
 *   好友申请 / 入群申请有自己的处理页「新的朋友」，不在列表里，只在页首给入口。
 *
 * 类型白名单镜像后端 notification.constants.ts 的 MOMENT_/CIRCLE_/GROUP_NOTICE_/
 * PROFILE_NOTIFICATION_TYPES。两边改一边就会出现「服务端算进未读数、客户端不显示」的
 * 幽灵红点，务必同改。
 */
export type NotificationDomain = 'moments' | 'circle' | 'notice' | 'group' | 'system';

/** 一条通知真正归属的分类（notice 是三类的合集，不是归属）。 */
type HomeDomain = Exclude<NotificationDomain, 'notice'>;

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
  'CIRCLE_POST_AUTO_ENDED',
  'CIRCLE_POST_COLLABORATION_RECOGNIZED',
  'CIRCLE_INVITATION_RECEIVED',
  'CIRCLE_MEMBER_REMOVED',
  'CIRCLE_DISSOLVED',
]);

const GROUP_NOTICE_TYPES: ReadonlySet<string> = new Set([
  'GROUP_MEMBER_REMOVED',
  'GROUP_DISSOLVED',
]);

const SYSTEM_TYPES: ReadonlySet<string> = new Set(['SYSTEM']);

const NOTICE_DOMAINS: ReadonlySet<HomeDomain> = new Set(['moments', 'group', 'system']);

/**
 * 被移出 / 解散的知会。只在站内出现：不推送、不弹横幅（聊天层收到 removed 事件时
 * 已经当场提示过），点开也没有落点（群已经不在了），只标已读。
 */
export const MEMBERSHIP_NOTICE_TYPES: ReadonlySet<string> = new Set([
  ...GROUP_NOTICE_TYPES,
  'CIRCLE_MEMBER_REMOVED',
  'CIRCLE_DISSOLVED',
]);

/**
 * 实时新通知直接插进通知池的类型（两个铃铛 + 消息页「通知」）。SYSTEM 不在内：
 * 公告扇出走自己的刷新，不推 notification.created。
 */
export const BELL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  ...MOMENT_TYPES,
  ...CIRCLE_TYPES,
  ...GROUP_NOTICE_TYPES,
]);

/**
 * 通知归属的分类；不属于任何入口时返回 null（好友申请 / 入群申请走「新的朋友」收件箱，
 * 报名走「报名管理」）。
 */
export function notificationDomain(
  type: NotificationType | string,
): HomeDomain | null {
  if (MOMENT_TYPES.has(type)) return 'moments';
  if (CIRCLE_TYPES.has(type)) return 'circle';
  if (GROUP_NOTICE_TYPES.has(type)) return 'group';
  if (SYSTEM_TYPES.has(type)) return 'system';
  return null;
}

/** 这条通知该不该出现在某个入口的列表里；不限域（推送兜底页）时什么都收。 */
export function isNotificationInDomain(
  type: NotificationType | string,
  domain: NotificationDomain | null,
): boolean {
  if (!domain) return true;
  const home = notificationDomain(type);
  if (!home) return false;
  return domain === 'notice' ? NOTICE_DOMAINS.has(home) : home === domain;
}

export function isNotificationDomain(
  value: unknown,
): value is NotificationDomain {
  return (
    value === 'moments' ||
    value === 'circle' ||
    value === 'notice' ||
    value === 'group' ||
    value === 'system'
  );
}

/** 路由参数 -> 域；非法/缺省值回落到 null（不限域，推送兜底页用）。 */
export function parseNotificationDomain(
  value: unknown,
): NotificationDomain | null {
  return isNotificationDomain(value) ? value : null;
}
