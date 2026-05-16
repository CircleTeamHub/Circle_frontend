import type { TFunction } from 'i18next';

// 同一份 just-now / minutesAgo / hoursAgo / daysAgo 文案在 moment-card 和 plaza-post-card
// 之前各写了一份。i18n key 已经存在（`common.justNow` 等），这里只是把"取 diff → 分桶 → 调 t"
// 的逻辑收敛起来。
export function formatRelativeTime(
  createdAt: string,
  t: TFunction,
): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('common.justNow');
  if (mins < 60) return t('common.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('common.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('common.daysAgo', { count: days });
}
