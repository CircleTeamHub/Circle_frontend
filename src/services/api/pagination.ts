interface Identified {
  id: string;
}

interface HeaderReader {
  get: (name: string) => string | null;
}

/** 解析 X-Has-More;读不到(网页端未暴露、老服务端)时返回 null,由调用方按条数兜底。 */
export function readHasMore(headers: HeaderReader): boolean | null {
  const value = headers.get('X-Has-More');
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** 追加没见过的行,返回这次新增了几行。 */
function appendUnique<T extends Identified>(target: T[], seen: Set<string>, rows: readonly T[]): number {
  let added = 0;
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    target.push(row);
    added += 1;
  }
  return added;
}

/**
 * 按页码翻到底,按 id 去重。偏移分页的已知局限:翻页期间别处改了某行(排序靠 updatedAt),
 * 它可能挪到已经翻过的页而这次漏掉 —— 下次重拉即恢复;本机的改动由调用方另行判断。
 * 一页一个新 id 都没带来(服务端忽略了 page 参数)就停,不空转到上限。
 */
export async function collectOffsetPages<T extends Identified>(
  fetchPage: (page: number) => Promise<{ rows: T[]; hasMore: boolean | null }>,
  options: { pageSize: number; maxPages: number },
): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= options.maxPages; page += 1) {
    const { rows, hasMore } = await fetchPage(page);
    const added = appendUnique(all, seen, rows);
    const more = hasMore ?? rows.length >= options.pageSize;
    if (!more || added === 0) break;
  }
  return all;
}

/** 按游标翻到底:从空游标开始,跟着服务端给的下一个游标走;游标不前进就停。 */
export async function collectCursorPages<T extends Identified>(
  fetchPage: (cursor: string) => Promise<{ rows: T[]; nextCursor: string | null }>,
  options: { maxPages: number },
): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  let cursor = '';
  for (let page = 0; page < options.maxPages; page += 1) {
    const { rows, nextCursor } = await fetchPage(cursor);
    appendUnique(all, seen, rows);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return all;
}
