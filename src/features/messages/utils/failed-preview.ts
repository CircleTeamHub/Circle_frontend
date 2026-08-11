import type { StoredChatMessage } from '@/chat-core/store';

/**
 * 会话预览要不要挂「发送失败」前缀。
 *
 * 判据是**最新的那条**是否失败,而不是「这个会话里存在失败消息」。
 *
 * 后者是原来的写法,踩过一次:一张早先没发出去的转账卡赖在 outbox 里,之后
 * 用户又正常发了好几条 —— 列表却把前缀贴在最新那条上,显示成
 * 「[发送失败] J」,而 J 明明发出去了(对端都标了未读)。
 *
 * 只能按时间比,不能按位置:失败气泡 height=0,排序上恒定落在所有已确认
 * 消息之后,「在时间线最后」对它永远成立,判不出新旧。
 */
export function hasFailedLatestMessage(
  messages: readonly StoredChatMessage[] | undefined,
): boolean {
  if (!messages?.length) return false;
  let newestAt = Number.NEGATIVE_INFINITY;
  let newestFailed = false;
  for (const message of messages) {
    const at = Date.parse(message.createdAt);
    if (!Number.isFinite(at)) continue;
    if (at > newestAt) {
      newestAt = at;
      newestFailed = Boolean(message.failed);
    } else if (at === newestAt && message.failed) {
      // 同一毫秒内的并列:只要有一条失败就算失败,宁可多提示不可漏。
      newestFailed = true;
    }
  }
  return newestFailed;
}
