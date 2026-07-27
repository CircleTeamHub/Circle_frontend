export async function collectCursorPages<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<T[]>,
  pageSize: number,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('page size must be a positive integer');
  }

  const items: T[] = [];
  const seenIds = new Set<string>();
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
    if (!nextCursor || nextCursor === cursor) {
      throw new Error('cursor did not advance');
    }
    cursor = nextCursor;
  }
}
