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

/**
 * Format the note creation date as a Chinese string shown below the title in edit screen.
 * e.g. "2026年4月10日 · 星期四"
 */
export function formatNoteFullDate(iso: string): string {
  const d = new Date(iso);
  const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${days[d.getDay()]}`;
}

/**
 * Build the card meta string: "04-10 14:32 | 日记 | 2图片 | 1视频"
 */
export function buildNoteMeta(params: {
  updatedAt: string;
  groupNames?: string[];
  imageCount: number;
  videoCount: number;
}): string {
  const parts: string[] = [formatNoteDate(params.updatedAt)];
  if ((params.groupNames?.length ?? 0) > 0) {
    const groupLabel =
      params.groupNames!.length <= 2
        ? params.groupNames!.join('、')
        : `${params.groupNames![0]}、${params.groupNames![1]} +${params.groupNames!.length - 2}`;
    parts.push(groupLabel);
  }
  if (params.imageCount > 0) parts.push(`${params.imageCount}图片`);
  if (params.videoCount > 0) parts.push(`${params.videoCount}视频`);
  return parts.join(' | ');
}
