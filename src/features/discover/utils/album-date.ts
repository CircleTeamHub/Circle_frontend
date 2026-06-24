const MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * 相册左侧日期列：返回日号 + 月份标签。
 * 中文显示「6月」，其他语言显示英文缩写「Jun」。
 */
export function getAlbumDateParts(
  createdAt: string,
  language: string,
): { day: string; month: string } {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return { day: '', month: '' };
  }
  const day = String(date.getDate());
  const monthIndex = date.getMonth();
  const month = language.startsWith('zh')
    ? `${monthIndex + 1}月`
    : MONTHS_EN[monthIndex];
  return { day, month };
}

/** 两个 ISO 时间是否同年同月同日。 */
export function isSameCalendarDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) {
    return false;
  }
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
