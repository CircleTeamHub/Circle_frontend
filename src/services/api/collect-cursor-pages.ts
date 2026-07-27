export async function collectCursorPages<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<T[]>,
  pageSize: number,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('page size must be a positive integer');
  }

  const items: T[] = [];
  const seenIds = new Set<string>();
  // 记录所有用过的游标（不只是上一个）：服务端若返回 A→B→A 这类长度大于 1 的环，
  // 逐步比较「与前一个是否相同」永远不会命中，循环会无限发请求。
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const page = await fetchPage(cursor);
    for (const item of page) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        items.push(item);
      }
    }

    if (page.length < pageSize) {
      return items;
    }

    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error('cursor did not advance');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}
