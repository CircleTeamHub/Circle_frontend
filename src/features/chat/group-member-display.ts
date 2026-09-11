import type { ChatMemberDto } from '@/chat-core/protocol';

type MemberLike = Pick<ChatMemberDto, 'userId' | 'nickname'> &
  Partial<Pick<ChatMemberDto, 'alias'>>;

/**
 * 群成员的显示名:群昵称(群备注) > 账号昵称 > userId 兜底。
 *
 * 只解析「这个人在群里叫什么」。**不含好友备注** —— 那是「我给对方起的名字、
 * 只有我看得见」,优先级更高,但它存在 friend-remark store 里而不是成员表上,
 * 由聊天页那条 override 链单独接(见 ChatDetailScreen.receivedDisplayName)。
 * 把两者混进同一个函数会让成员目录也吃到我的私有备注,而目录展示的是群内身份。
 */
export function groupMemberDisplayName(member: MemberLike): string {
  return member.alias?.trim() || member.nickname?.trim() || member.userId;
}

/** 搜索匹配:群昵称、账号昵称、userId 任一命中即可。 */
export function groupMemberMatchesQuery(
  member: MemberLike,
  loweredQuery: string,
): boolean {
  if (!loweredQuery) return true;
  return [member.alias, member.nickname, member.userId].some(
    (value) => typeof value === 'string' && value.toLowerCase().includes(loweredQuery),
  );
}
