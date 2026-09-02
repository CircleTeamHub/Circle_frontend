export type GroupListFilter = 'created' | 'joined' | 'managed';

interface FilterableGroup {
  groupName: string;
  introduction: string | null;
  ownerUserID: string;
  myRole: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
}

function isCreatedByCurrentUser(
  group: FilterableGroup,
  currentUserID: string | null,
): boolean {
  return (
    group.myRole === 'OWNER' ||
    (Boolean(currentUserID) && group.ownerUserID === currentUserID)
  );
}

export function filterGroupList<T extends FilterableGroup>(
  groups: T[],
  filter: GroupListFilter,
  currentUserID: string | null,
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return groups.filter((group) => {
    const createdByCurrentUser = isCreatedByCurrentUser(group, currentUserID);
    const matchesFilter =
      filter === 'created'
        ? createdByCurrentUser
        : filter === 'joined'
          ? !createdByCurrentUser
          : createdByCurrentUser || group.myRole === 'ADMIN';

    if (!matchesFilter) return false;
    if (!normalizedQuery) return true;

    return [group.groupName, group.introduction ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
}
