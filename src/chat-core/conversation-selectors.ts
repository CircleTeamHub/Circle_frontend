import type { ChatConversationDto } from './protocol';

/**
 * 整张会话列表。模块级常量:配合 useStoreWhileActive 使用时,取值函数引用稳定,
 * 返回的也是 store 里的现成数组(不可变更新,没变就是同一个引用)。
 */
export function selectConversations(state: {
  conversations: ChatConversationDto[];
}): ChatConversationDto[] {
  return state.conversations;
}
