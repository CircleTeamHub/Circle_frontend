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
  const lang = language.toLowerCase();
  // 中/日用「N月」，韩用「N월」，其余语言用英文月份缩写。
  let month: string;
  if (lang.startsWith('zh') || lang.startsWith('ja')) {
    month = `${monthIndex + 1}月`;
  } else if (lang.startsWith('ko')) {
    month = `${monthIndex + 1}월`;
  } else {
    month = MONTHS_EN[monthIndex];
  }
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
