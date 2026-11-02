import type { PrivacySettings } from '@/services/api/privacy';

/**
 * 隐私设置页的内存缓存:再进这页先画上次从服务端拿到的真实设置,后台照常重拉。
 * 没有它,每次进来都先画一遍默认值再跳成真实值 —— 那一瞬间开关显示的不是用户自己的设置。
 *
 * - 只在内存:App 重启即清空。
 * - 按账号隔离:sessionEpoch 变了(登录/退出/切号)就作废。
 * - 只存服务端返回的值:乐观更新不写进来,保存失败回滚后这里仍是真值。
 */
let cached: { epoch: number; settings: PrivacySettings } | null = null;

export function readPrivacySettingsCache(epoch: number): PrivacySettings | null {
  if (cached?.epoch !== epoch) cached = null;
  return cached?.settings ?? null;
}

export function writePrivacySettingsCache(
  epoch: number,
  settings: PrivacySettings,
): void {
  cached = { epoch, settings };
}
