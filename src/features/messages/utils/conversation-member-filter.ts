import type { Conversation } from '@/types';

export type ConversationMemberFilter = 'all' | 'group' | 'private' | 'selected';

type FilterableConversation = Pick<
  Conversation,
  'id' | 'name' | 'conversationType'
>;

export function filterConversationMembers<T extends FilterableConversation>(
  conversations: readonly T[],
  filter: ConversationMemberFilter,
  rawQuery: string,
  selectedIDs: ReadonlySet<string>,
): T[] {
  const query = rawQuery.trim().toLocaleLowerCase();

  return conversations.filter((conversation) => {
    if (filter === 'group' && conversation.conversationType !== 'group') {
      return false;
    }
    if (filter === 'private' && conversation.conversationType !== 'private') {
      return false;
    }
    if (filter === 'selected' && !selectedIDs.has(conversation.id)) {
      return false;
    }

    return !query || conversation.name.toLocaleLowerCase().includes(query);
  });
}

export function toggleFilteredConversationMembers(
  currentIDs: readonly string[],
  visibleIDs: readonly string[],
  select: boolean,
): string[] {
  if (select) return Array.from(new Set([...currentIDs, ...visibleIDs]));

  const visibleIDSet = new Set(visibleIDs);
  return currentIDs.filter((id) => !visibleIDSet.has(id));
}
