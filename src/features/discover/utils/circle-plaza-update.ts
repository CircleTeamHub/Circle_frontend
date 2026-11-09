import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { markCirclePlazaSeen } from '@/services/api/plaza';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

/**
 * 用户拿到了最新的圈子帖子列表：收掉飞机红点并告诉服务端「看过了」。
 *
 * 不看本地红点亮没亮：实时信号被限频窗口吞掉时本地是灭的、服务端却算有更新，
 * 不上报的话，下一帧快照会为他已经看过的帖子再亮一次。
 */
export function clearCirclePlazaUpdate(): void {
  useTabBadgeStore.getState().setCirclePlazaHasUpdate(false);
  // 失败时红点会在下一帧快照里回来，再点一次就好，不必打断用户。
  void markCirclePlazaSeen().catch((error: unknown) => {
    reportHandledFailure('circlePlaza', 'markSeen', error);
  });
}

/** 点飞机 tab：有红点才收掉并拉一次最新列表；没亮时切 tab 不花任何请求。 */
export function openCirclePlazaUpdate(): void {
  if (!useTabBadgeStore.getState().circlePlazaHasUpdate) return;

  clearCirclePlazaUpdate();
  const discover = useDiscoverStore.getState();
  // 从没拉过说明页面是第一次挂载，它自己的 effect 会拉，这里再拉就成两次了。
  if (discover.plazaLatestRequestId > 0) void discover.fetchPlazaPosts(true);
}
