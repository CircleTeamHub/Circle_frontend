import { groupOrCircleMutatedSince } from '@/features/chat/utils/group-reload-key';
import type { GroupAdmissionDetail } from '@/services/api/group-admissions';
import { getPageSnapshotRevision, readPageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';
import { useAuthStore } from '@/stores/authStore';
import type { CircleInvitation } from '@/types';

export type GroupAdmissionsSnapshot = {
  items: GroupAdmissionDetail[];
  circleInvitations: CircleInvitation[];
  nextCursor: string | null;
};

const snapshotKey = (groupId: string | undefined) => `social:group-admissions:${groupId ?? 'inbox'}`;

/**
 * 「新的群组」（以及群管理里的入群记录）第一页的展示快照：再进这页先画上次拉到的，后台照常
 * 重拉——线路差时不再每次从空白转圈。
 *
 * - 同账号加密保存（page-snapshots），sessionEpoch 变了（登录 / 退出 / 切号）就作废。
 * - at 是那次请求发出的时刻。之后有过群或圈子写请求（审批、接受、标记已读…）就不用：
 *   那份列表可能把已处理的邀请画回「待处理」。宁可像以前一样转圈。
 */
export function readGroupAdmissionsSnapshot(
  epoch: number,
  groupId: string | undefined,
  mutatedSince: (since: number) => boolean,
): GroupAdmissionsSnapshot | null {
  const auth = useAuthStore.getState();
  if (auth.sessionEpoch !== epoch) return null;
  const saved = readPageSnapshot<GroupAdmissionsSnapshot>(auth.user?.id, snapshotKey(groupId));
  return saved && !mutatedSince(saved.at) ? saved.value : null;
}

/** requestRevision：请求发出时的快照版本；期间快照被清过（退出登录、清缓存）就不写。 */
export function writeGroupAdmissionsSnapshot(
  epoch: number,
  groupId: string | undefined,
  snapshot: GroupAdmissionsSnapshot,
  at: number,
  requestRevision: number,
): void {
  const auth = useAuthStore.getState();
  if (auth.sessionEpoch !== epoch) return;
  if (requestRevision !== getPageSnapshotRevision() || groupOrCircleMutatedSince(at)) return;
  writePageSnapshot(auth.user?.id, snapshotKey(groupId), snapshot, at);
}
