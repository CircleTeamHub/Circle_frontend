interface CatchUpConversation {
  id: string;
  type: string;
  lastMessage: { height: number; sender: { id: string } | null } | null;
  lastMessageAt: string | null;
}

/**
 * 一次最多补报几个会话。服务端送达限流每人 10 秒 30 次、超出的静默丢弃,实时收到消息
 * 的送达也走同一份额度 —— 补报不能把它占满。超出的是最不活跃的那些:对方继续显示
 * 「已发送」,这边点开会话就变「已读」。
 */
export const DELIVERED_CATCH_UP_LIMIT = 20;

/**
 * 重连对账时要补报的「已送达」水位。
 *
 * 「已送达」平时只在实时收到消息时上报;连接断开期间(安卓后台挂起、断网)收到的消息
 * 只走了推送,重连后由同步补齐,却没人替它们报送达 —— 对方会一直看到「已发送」,直到
 * 这边点开会话变成「已读」。口径与实时那条一致:只报单聊、只报别人发的、只报这次真的
 * 新到的(末条比断开时本机记的高),最近活跃的排前面。
 */
export function deliveredCatchUpReports(
  previousLastHeights: ReadonlyMap<string, number>,
  snapshot: readonly CatchUpConversation[],
  currentUserId: string,
  limit = DELIVERED_CATCH_UP_LIMIT,
): { conversationId: string; height: number }[] {
  const candidates: { conversationId: string; height: number; at: string }[] = [];
  for (const conversation of snapshot) {
    if (conversation.type === 'GROUP') continue;
    const last = conversation.lastMessage;
    if (!last || last.height <= 0 || !last.sender) continue;
    if (last.sender.id === currentUserId) continue;
    if (last.height <= (previousLastHeights.get(conversation.id) ?? 0)) continue;
    candidates.push({
      conversationId: conversation.id,
      height: last.height,
      at: conversation.lastMessageAt ?? '',
    });
  }
  return candidates
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
    .map(({ conversationId, height }) => ({ conversationId, height }));
}
