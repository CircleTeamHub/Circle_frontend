import type { PrivacySettings } from '@/services/api/privacy';
import { useAuthStore } from '@/stores/authStore';
import { getPageSnapshotRevision, readPageSnapshot, removePageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';

/**
 * 隐私设置与自动回复共用的展示快照:先画上次服务端确认的设置,后台照常重拉。
 * 没有它,每次进来都先画一遍默认值再跳成真实值 —— 那一瞬间开关显示的不是用户自己的设置。
 *
 * - 原生端使用加密快照跨重启恢复;web 只留内存。
 * - 按账号隔离:sessionEpoch 变了(登录/退出/切号)就作废。
 * - 只存服务端返回的值:乐观更新不写进来,保存失败回滚后这里仍是真值。
 */
const SNAPSHOT_KEY = 'settings:privacy';
let cached: { userId: string; epoch: number; revision: number; settings: PrivacySettings } | null = null;

export function readPrivacySettingsCache(epoch: number): PrivacySettings | null {
  const { user, sessionEpoch } = useAuthStore.getState();
  if (!user || sessionEpoch !== epoch) return null;
  const revision = getPageSnapshotRevision();
  if (!cached || cached.epoch !== epoch || cached.userId !== user.id || cached.revision !== revision) cached = null;
  if (!cached) {
    const restored = readPageSnapshot<PrivacySettings>(user.id, SNAPSHOT_KEY);
    if (restored) cached = { userId: user.id, epoch, revision, settings: restored.value };
  }
  return cached?.settings ?? null;
}

export function writePrivacySettingsCache(
  epoch: number,
  settings: PrivacySettings,
  revision = getPageSnapshotRevision(),
  at = Date.now(),
): void {
  const { user, sessionEpoch } = useAuthStore.getState();
  if (!user || sessionEpoch !== epoch || getPageSnapshotRevision() !== revision) return;
  cached = { userId: user.id, epoch, revision, settings };
  writePageSnapshot(user.id, SNAPSHOT_KEY, settings, at);
}

export function clearPrivacySettingsCache(epoch: number): void {
  const { user, sessionEpoch } = useAuthStore.getState();
  if (sessionEpoch !== epoch) return;
  cached = null;
  removePageSnapshot(user?.id, SNAPSHOT_KEY);
}
