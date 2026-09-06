interface SearchableGroup {
  groupName: string;
  introduction: string | null;
}

/**
 * 按关键词过滤群聊列表。
 *
 * 分类（新的 / 我加入的 / 我创建的 / 我管理的）是 GroupsScreen 从三次服务端查询
 * 里算好的，这里只在当前分类内部做本地匹配，不再重复判断成员身份。
 *
 * 匹配名称和简介两处：列表行本来就同时展示这两个字段，只搜名称会让用户在看得见
 * 的文字上搜不到东西。
 */
export function filterGroupsByQuery<T extends SearchableGroup>(
  groups: T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return groups;

  return groups.filter((group) =>
    [group.groupName, group.introduction ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
}
