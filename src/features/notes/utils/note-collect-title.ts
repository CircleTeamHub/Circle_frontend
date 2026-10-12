/**
 * 收藏笔记的默认标题。用空格连接分组、用户名和原标题；用户可以在保存前自由修改。
 */
export function buildCollectedNoteTitle(input: {
  groupName?: string | null;
  username?: string | null;
  originalTitle: string;
}): string {
  const group = input.groupName?.trim() || '未分组';
  const username = input.username?.trim() || '我';
  const title = input.originalTitle.trim() || '未命名笔记';
  return `${group} ${username} ${title}`;
}
