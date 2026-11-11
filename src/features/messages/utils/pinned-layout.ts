export type PinnedGroupPosition = 'single' | 'first' | 'middle' | 'last' | 'none';

interface PinnableRow {
  id: string;
  pinned?: boolean;
}

export interface PinnedLayout {
  /** 置顶行在所在分组里的位置;非置顶行不在表里(按 'none' 处理)。 */
  positions: ReadonlyMap<string, PinnedGroupPosition>;
  /** 一段置顶的最后一行(last / single):后面不画分隔线,置顶灰切回列表底色本身就是分界。 */
  hiddenSeparatorIds: ReadonlySet<string>;
  /** 后面还紧跟着置顶行的置顶行(first / middle):分隔线垫置顶底色,通栏色带不断开。 */
  pinnedSeparatorIds: ReadonlySet<string>;
}

const ROW_SEPARATOR = '\n';
const FIELD_SEPARATOR = '\t';

function positionAt(rows: readonly PinnableRow[], index: number): PinnedGroupPosition {
  if (!rows[index]?.pinned) return 'none';
  const previousPinned = Boolean(rows[index - 1]?.pinned);
  const nextPinned = Boolean(rows[index + 1]?.pinned);
  if (!previousPinned && !nextPinned) return 'single';
  if (!previousPinned) return 'first';
  if (!nextPinned) return 'last';
  return 'middle';
}

/**
 * 置顶分组形状的签名串:只含置顶行的 id 与位置。
 *
 * 新消息只会改非置顶会话的预览、把它挪到非置顶区顶部,置顶分组的形状不变,签名也就不变。
 * 拿它当 useMemo 依赖,renderItem / 分隔线就不会每来一条消息都换引用 ——
 * 换了引用,FlatList 会把可见行全部重新过一遍。
 */
export function pinnedLayoutKeyOf(rows: readonly PinnableRow[]): string {
  const entries: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const position = positionAt(rows, index);
    if (position !== 'none') {
      entries.push(`${rows[index].id}${FIELD_SEPARATOR}${position}`);
    }
  }
  return entries.join(ROW_SEPARATOR);
}

export function parsePinnedLayoutKey(key: string): PinnedLayout {
  const positions = new Map<string, PinnedGroupPosition>();
  const hiddenSeparatorIds = new Set<string>();
  const pinnedSeparatorIds = new Set<string>();
  if (!key) return { positions, hiddenSeparatorIds, pinnedSeparatorIds };
  for (const entry of key.split(ROW_SEPARATOR)) {
    const [id, position] = entry.split(FIELD_SEPARATOR) as [string, PinnedGroupPosition];
    positions.set(id, position);
    if (position === 'first' || position === 'middle') pinnedSeparatorIds.add(id);
    else hiddenSeparatorIds.add(id);
  }
  return { positions, hiddenSeparatorIds, pinnedSeparatorIds };
}
