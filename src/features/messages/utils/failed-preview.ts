import type { StoredChatMessage } from '@/chat-core/store';

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 会话预览要不要挂「发送失败」前缀。
 *
 * 判据是**最新一次发送尝试**是否失败,而不是「这个会话里存在失败消息」。
 *
 * 后者是最早的写法,踩过一次:一张早先没发出去的转账卡赖在 outbox 里,之后
 * 用户又正常发了好几条 —— 列表却把前缀贴在最新那条上,显示成
 * 「[发送失败] J」,而 J 明明发出去了(对端都标了未读)。
 *
 * 判据也不能按**位置**:失败气泡 height=0,排序上恒定落在所有已确认消息
 * 之后,「在时间线最后」对它永远成立,判不出新旧。
 *
 * 判据同样不能按**时间戳**(codex review 修正)。失败气泡的 createdAt 来自
 * 设备时钟,已确认消息带的是服务端时钟 —— 两个域直接比大小,设备快几分钟
 * 就会让那条失败消息在这几分钟里恒为「最新」,期间发成功的消息全被它压住,
 * 前缀撤不掉。用户手机时间不准是常态,不是边缘情况。
 *
 * 所以改用 height:它是服务端在 advisory lock 下发的单调号,天然与时钟无关。
 * 点击发送时快照下当时会话里的最大 height(failedAfterHeight),
 * 之后只要出现更大的 height,就说明这次失败之后确实又有消息落库了。
 * 拉历史带回来的旧消息 height 更小,不会误清前缀。
 */
export function hasFailedLatestMessage(
  messages: readonly StoredChatMessage[] | undefined,
): boolean {
  if (!messages?.length) return false;
  let maxHeight = 0;
  for (const message of messages) {
    const height = finiteOrZero(message.height);
    if (height > maxHeight) maxHeight = height;
  }
  for (const message of messages) {
    if (!message.failed) continue;
    // 缺 failedAfterHeight 只会发生在旧版 outbox 或本函数之外构造的对象上:
    // 按 0 处理 ——
    // 会话里一旦有任何已确认消息就不提示,宁可漏提示不误报。
    if (finiteOrZero(message.failedAfterHeight) >= maxHeight) return true;
  }
  return false;
}
