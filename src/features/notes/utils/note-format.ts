import type { TFunction } from 'i18next';

/**
 * Format note date for the card meta line.
 * Today: "14:32", this year: "04-10 14:32", other: "2025-04-10"
 */
export function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const isThisYear = d.getFullYear() === now.getFullYear();

  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  if (isToday) return `${hh}:${mm}`;
  if (isThisYear) return `${month}-${day} ${hh}:${mm}`;
  return `${d.getFullYear()}-${month}-${day}`;
}

const DAY_KEYS = [
  'notes.format.day.sun',
  'notes.format.day.mon',
  'notes.format.day.tue',
  'notes.format.day.wed',
  'notes.format.day.thu',
  'notes.format.day.fri',
  'notes.format.day.sat',
] as const;

const DAY_DEFAULTS = [
  '星期日',
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
] as const;

/**
 * Format the note creation date as a localized string shown below the title.
 * zh default: "2026年4月10日 · 星期四"
 */
export function formatNoteFullDate(iso: string, t: TFunction): string {
  const d = new Date(iso);
  const dayLabel = t(DAY_KEYS[d.getDay()], {
    defaultValue: DAY_DEFAULTS[d.getDay()],
  });
  return t('notes.format.fullDate', {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: dayLabel,
    defaultValue: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${dayLabel}`,
  });
}

/**
 * Build the card meta string. zh default: "04-10 14:32 | 日记 | 2图片 | 1视频"
 */
export function buildNoteMeta(
  params: {
    updatedAt: string;
    groupNames?: string[];
    imageCount: number;
    videoCount: number;
  },
  t: TFunction,
): string {
  const parts: string[] = [formatNoteDate(params.updatedAt)];
  if ((params.groupNames?.length ?? 0) > 0) {
    const groupLabel =
      params.groupNames!.length <= 2
        ? params.groupNames!.join('、')
        : t('notes.format.groupOverflow', {
            first: params.groupNames![0],
            second: params.groupNames![1],
            extra: params.groupNames!.length - 2,
            defaultValue: `${params.groupNames![0]}、${params.groupNames![1]} +${params.groupNames!.length - 2}`,
          });
    parts.push(groupLabel);
  }
  if (params.imageCount > 0) {
    parts.push(
      t('notes.format.imageCount', {
        count: params.imageCount,
        defaultValue: `${params.imageCount}图片`,
      }),
    );
  }
  if (params.videoCount > 0) {
    parts.push(
      t('notes.format.videoCount', {
        count: params.videoCount,
        defaultValue: `${params.videoCount}视频`,
      }),
    );
  }
  return parts.join(' | ');
}
