/**
 * 「新的朋友」收件箱的本地关键词过滤。
 *
 * 行上展示的是昵称（没有昵称时回落账号），所以两处都参与匹配 —— 只搜昵称会让
 * 只记得账号的用户搜不到人。
 */
interface SearchableFriendInboxRow {
  activity: { counterparty: { nickname: string; accountId: string } };
}

export function filterFriendInboxRows<T extends SearchableFriendInboxRow>(
  rows: T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return rows;

  return rows.filter((row) =>
    [row.activity.counterparty.nickname, row.activity.counterparty.accountId].some(
      (value) => (value ?? '').toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
}
