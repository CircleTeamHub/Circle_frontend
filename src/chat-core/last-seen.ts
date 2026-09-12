/**
 * 「最近在线」的档位:界面只关心到分钟 / 小时 / 天,不显示秒。
 * 纯函数,便于无 React 环境单测;now 由调用方传入(hook 里每分钟刷新一次)。
 */
export type LastSeenUnit = 'justNow' | 'minutes' | 'hours' | 'days';

export interface LastSeenBucket {
  unit: LastSeenUnit;
  /** justNow 恒为 0;其余为对应单位的整数(向下取整)。 */
  count: number;
}

const MINUTE_MS = 60_000;

export function describeLastSeen(
  lastSeenAt: string | null | undefined,
  nowMs: number,
): LastSeenBucket | null {
  if (!lastSeenAt) return null;
  const at = Date.parse(lastSeenAt);
  if (!Number.isFinite(at)) return null;
  // 客户端与服务端时钟可能有偏差:落在未来的时刻按「刚刚」处理,不显示负数。
  const minutes = Math.floor(Math.max(0, nowMs - at) / MINUTE_MS);
  if (minutes < 1) return { unit: 'justNow', count: 0 };
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}

/** 各档位对应的文案键(五语种都有;带 count 的走 i18next 复数)。 */
export const LAST_SEEN_LABEL_KEYS: Record<LastSeenUnit, string> = {
  justNow: 'chat.detail.lastSeenJustNow',
  minutes: 'chat.detail.lastSeenMinutes',
  hours: 'chat.detail.lastSeenHours',
  days: 'chat.detail.lastSeenDays',
};
