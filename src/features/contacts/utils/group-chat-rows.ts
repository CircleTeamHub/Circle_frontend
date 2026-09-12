/**
 * 群聊列表的共用口径：「我的群聊」和「新的朋友 / 新的群组」都吃这两个函数。
 *
 * 群聊 = 会话（ChatConversation type=GROUP，含圈子群与独立群），不是圈子。
 * 群聊没有入群申请这一套（拉人即进、扫码即进，后端没有 join-request 模型），
 * 所以「新」只能按本人入群时刻算：ChatMember.joinedAt，由会话 DTO 透出。
 */
interface JoinableConversation {
  type: string;
  /** 本人入群时刻；老后端不返回。 */
  joinedAt?: string | null;
  lastMessageAt: string | null;
}

function timeOf(conversation: JoinableConversation): number {
  const raw = conversation.joinedAt ?? conversation.lastMessageAt;
  if (!raw) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** 群聊会话，最近加入的排最前。临时房和单聊不是「群聊」，不进这张表。 */
export function selectGroupConversations<T extends JoinableConversation>(
  conversations: T[],
): T[] {
  return conversations
    .filter((conversation) => conversation.type === 'GROUP')
    .sort((left, right) => timeOf(right) - timeOf(left));
}

/**
 * 按关键词过滤。匹配群名和副标题（公告/加入时间等行上第二行的文字）——
 * 只搜群名会让用户在看得见的文字上搜不到东西。
 */
export function filterGroupChatRows<
  T extends { name: string; subtitle?: string | null },
>(rows: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return rows;

  return rows.filter((row) =>
    [row.name, row.subtitle ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
}
