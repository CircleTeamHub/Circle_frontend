import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { markCirclePlazaSeen } from '@/services/api/plaza';
import { useAuthStore } from '@/stores/authStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

/** 先成功应用列表，再确认这次响应的服务端快照水位。 */
export async function refreshCirclePlazaUpdate(): Promise<void> {
  const sessionEpoch = useAuthStore.getState().sessionEpoch;
  const snapshotAt = await useDiscoverStore.getState().fetchPlazaPosts(true);
  if (snapshotAt === null || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;

  const { circlePlazaHasUpdate: wasLit, circlePlazaChangedAt: previousVersion } = useTabBadgeStore.getState();
  useTabBadgeStore.getState().setCirclePlazaHasUpdate(false);
  try {
    const { hasUpdate, changedAt } = await markCirclePlazaSeen(snapshotAt);
    if (useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
    useTabBadgeStore.getState().setCirclePlazaHasUpdate(hasUpdate, Date.parse(changedAt));
  } catch (error) {
    if (useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
    if (wasLit && useTabBadgeStore.getState().circlePlazaChangedAt === previousVersion) {
      useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
    }
    reportHandledFailure('circlePlaza', 'markSeen', error);
  }
}

/** 首次加载交给页面；有缓存且带红点时点击 tab 才主动刷新。 */
export function openCirclePlazaUpdate(): void {
  if (!useTabBadgeStore.getState().circlePlazaHasUpdate) return;
  const discover = useDiscoverStore.getState();
  if (discover.plazaLatestRequestId === 0 || discover.plazaLoading || discover.plazaRefreshing) return;
  void refreshCirclePlazaUpdate();
}
