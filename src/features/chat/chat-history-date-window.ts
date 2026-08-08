export interface LocalDaySearchWindow {
  positionSeconds: number;
  periodSeconds: number;
}

export function resolveLocalDaySearchWindow(
  date: string,
): LocalDaySearchWindow | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const start = new Date(year, monthIndex, day);
  if (
    start.getFullYear() !== year ||
    start.getMonth() !== monthIndex ||
    start.getDate() !== day
  ) {
    return null;
  }

  const end = new Date(year, monthIndex, day + 1);
  return {
    positionSeconds: Math.floor(start.getTime() / 1000),
    periodSeconds: Math.floor((end.getTime() - start.getTime()) / 1000),
  };
}
