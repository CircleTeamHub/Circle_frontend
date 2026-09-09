import type { TopNoticeType } from './top-notice-store';

type HapticsModule = typeof import('expo-haptics');

let modulePromise: Promise<HapticsModule | null> | null = null;

function loadHaptics(): Promise<HapticsModule | null> {
  // 与 use-notification-feedback 同一套路：懒加载，没重建过原生的 dev client
  // 缺模块时静默降级，不拖启动、不崩。
  modulePromise ??= import('expo-haptics').catch(() => null);
  return modulePromise;
}

/**
 * 顶部提醒的触感：成功 / 错误 / 警告各用系统对应的通知型震动，info 不震
 * （纯信息不该打断手感）。失败一律吞掉。
 */
export async function fireTopNoticeHaptic(type: TopNoticeType): Promise<void> {
  if (type === 'info') return;
  const haptics = await loadHaptics();
  if (!haptics) return;
  const feedback =
    type === 'success'
      ? haptics.NotificationFeedbackType.Success
      : type === 'error'
        ? haptics.NotificationFeedbackType.Error
        : haptics.NotificationFeedbackType.Warning;
  await haptics.notificationAsync(feedback).catch(() => undefined);
}
