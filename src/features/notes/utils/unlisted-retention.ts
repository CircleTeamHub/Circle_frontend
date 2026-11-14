/** 下架的笔记 60 天后由服务端永久删除（从下架那一刻算，上线前已下架的从上线日算）。 */
export const UNLISTED_RETENTION_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 还剩几天被自动删除；不足一天按 1 天显示，服务端没给下架时间（老接口）返回 null。 */
export function unlistedDaysLeft(unlistedAt: string | null | undefined, now: number): number | null {
  const start = unlistedAt ? Date.parse(unlistedAt) : NaN;
  if (Number.isNaN(start)) return null;
  const left = start + UNLISTED_RETENTION_DAYS * DAY_MS - now;
  return Math.max(1, Math.ceil(left / DAY_MS));
}
