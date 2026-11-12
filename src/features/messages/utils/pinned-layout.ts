interface ListRow {
  id: string;
  pinned?: boolean;
}

const ROW_SEPARATOR = '\n';

/**
 * 不画分隔线的行:列表第一行,以及置顶 / 非置顶交界处的那一行(底色切换本身就是分界)。
 * 分隔线画在每行的顶边 —— 安卓把每行的位置和高度分别取整,相邻两行会差出 1px,
 * 画在上一行底边的线会被下一行盖住,画在本行顶边的不会。
 *
 * 返回的是签名串,拿它当 useMemo 依赖:只有交界处换了会话时才变,
 * 新消息只在非置顶区内部挪动时它不变,renderItem 不跟着换引用。
 */
export function dividerlessRowsKeyOf(rows: readonly ListRow[]): string {
  const ids: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    if (!previous || Boolean(previous.pinned) !== Boolean(rows[index].pinned)) {
      ids.push(rows[index].id);
    }
  }
  return ids.join(ROW_SEPARATOR);
}

export function parseDividerlessRowsKey(key: string): ReadonlySet<string> {
  return new Set(key ? key.split(ROW_SEPARATOR) : []);
}
