import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { notificationDomain } from '@/features/notifications/utils/notification-domain';

/**
 * 一条未读通知刚被看过：按它的归属扣对应入口的计数，等服务端下一帧未读事件校准。
 * 只扣总数会让所属铃铛的红点一直挂着；扣错入口则会把别的入口的红点抹掉。
 */
export function decrementUnreadBadgesFor(type: string): void {
  const badges = useTabBadgeStore.getState();
  const domain = notificationDomain(type);
  // discoverUnread 是两个铃铛的合计口径（老客户端还在读），群聊知会与公告不在其中。
  if (domain === 'moments' || domain === 'circle') {
    badges.setDiscoverUnread(Math.max(0, badges.discoverUnread - 1));
  }
  if (domain === 'moments') badges.setMomentsUnread(Math.max(0, badges.momentsUnread - 1));
  if (domain === 'circle') badges.setCircleUnread(Math.max(0, badges.circleUnread - 1));
  if (domain === 'group') badges.setGroupNoticeUnread(Math.max(0, badges.groupNoticeUnread - 1));
  if (domain === 'system') badges.setProfileUnread(Math.max(0, badges.profileUnread - 1));
}
