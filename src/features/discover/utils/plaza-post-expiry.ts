/**
 * 活动卡片左侧强调竖条的配色按「距到期的剩余时间」分档，随时间推移在天级阈值处逐级
 * 跳变（帖子越接近到期越醒目，驱动及时报名）：
 *   - urgent（剩余 ≤ 1天）：紧急，快结束了 → 红
 *   - soon（剩余 ≤ 3天）：临近结束 → 橙
 *   - ample（剩余 > 3天，最多 7天）：时间充裕 → 紫
 * 组件再把档位映射到主题色（urgent→error / soon→warning / ample→primary）。
 * 剩余时间以「到期时间 − 当前时间」计算，因此同一帖子会随时间从 ample→soon→urgent
 * 逐级变色。到期时间非法时回落到 ample（最温和的配色）。
 */
export type PostExpiryTier = 'urgent' | 'soon' | 'ample';

const HOUR_MS = 60 * 60 * 1000;
// 天级阈值：1天 / 3天（最长档为 7天）。
const URGENT_MAX_HOURS = 24;
const SOON_MAX_HOURS = 72;

export function getPostExpiryTier(
  expiresAt: string,
  now: number = Date.now(),
): PostExpiryTier {
  const remainingHours = (new Date(expiresAt).getTime() - now) / HOUR_MS;
  if (Number.isNaN(remainingHours)) return 'ample';
  if (remainingHours <= URGENT_MAX_HOURS) return 'urgent';
  if (remainingHours <= SOON_MAX_HOURS) return 'soon';
  return 'ample';
}
