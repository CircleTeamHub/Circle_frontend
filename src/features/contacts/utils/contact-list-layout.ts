export interface ContactListLayoutMetrics {
  /** 列表头(标题、搜索、快捷入口)的实测高度。 */
  listHeaderHeight: number;
  sectionHeaderHeight: number;
  rowHeight: number;
}

export interface ContactListItemLayout {
  index: number;
  offset: number;
  length: number;
}

/**
 * 通讯录 SectionList 的 getItemLayout:按扁平下标算出每个单元格的位置。
 *
 * SectionList 把每个分组摊平成 [分组标题, ...好友行, 分组尾],分组尾没有内容、高度为 0;
 * offset 要从列表头之后算起 —— 已挂载单元格的实测 offset 本来就含列表头,两边口径必须一致,
 * 否则点远处字母(还没渲染过的分组)会差一个列表头的高度。
 */
export function getContactListItemLayout(
  sections: readonly { data: readonly unknown[] }[],
  index: number,
  { listHeaderHeight, sectionHeaderHeight, rowHeight }: ContactListLayoutMetrics,
): ContactListItemLayout {
  let offset = listHeaderHeight;
  let cursor = index;

  for (const section of sections) {
    const rowCount = section.data.length;
    if (cursor === 0) return { index, offset, length: sectionHeaderHeight };
    if (cursor <= rowCount) {
      return { index, offset: offset + sectionHeaderHeight + (cursor - 1) * rowHeight, length: rowHeight };
    }
    offset += sectionHeaderHeight + rowCount * rowHeight;
    if (cursor === rowCount + 1) return { index, offset, length: 0 };
    cursor -= rowCount + 2;
  }

  return { index, offset, length: 0 };
}
