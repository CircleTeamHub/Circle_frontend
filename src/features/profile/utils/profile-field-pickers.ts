export interface BirthdayDraft {
  year: number;
  month: number;
  day: number;
}

/** 生日年份下限:1950 年起,到今年为止。 */
const BIRTHDAY_FIRST_YEAR = 1950;

export function padTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 解析 `YYYY-MM-DD`;格式不对时回落到今天,方便滚轮有个起点。 */
export function parseBirthdayValue(value: string, today = new Date()): BirthdayDraft {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return {
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      day: today.getDate(),
    };
  }

  const [yearText, monthText, dayText] = value.split('-');
  return {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
  };
}

export function formatBirthdayDraft(draft: BirthdayDraft): string {
  return `${draft.year}-${padTwoDigits(draft.month)}-${padTwoDigits(draft.day)}`;
}

/** 换年/换月后把日钳到当月最后一天(2 月 30 日 → 2 月 28/29 日)。 */
export function updateBirthdayDraft(
  draft: BirthdayDraft,
  patch: Partial<BirthdayDraft>,
): BirthdayDraft {
  const next = { ...draft, ...patch };
  return { ...next, day: Math.min(next.day, getDaysInMonth(next.year, next.month)) };
}

export function getBirthdayYears(currentYear = new Date().getFullYear()): number[] {
  return Array.from(
    { length: currentYear - BIRTHDAY_FIRST_YEAR + 1 },
    (_, index) => currentYear - index,
  );
}
