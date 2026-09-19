/**
 * 一次发送的两个时刻。
 *
 * - queued:乐观气泡已经上屏、消息进了发送队列。断线时它在队列里等重连(最长一分钟,
 *   见 send-queue),所以调用方不该等到送达才清草稿、放开输入框 —— 那样断线时输入框
 *   会被锁住一分钟。
 * - delivered:服务端确认,或确定发不出去(气泡已经标红,可以长按重发)。
 *
 * queued 为 false 表示本地门禁(信用分)直接拦下、什么都没上屏:delivered 带着原因
 * reject,调用方应当保留草稿并给出提示。
 */
export interface ChatSendHandle<T> {
  queued: boolean;
  delivered: Promise<T>;
}

/**
 * send 收到的 onCreate 要原样交给 chat-core 的发送函数:乐观消息上屏时同步回调,
 * 早于任何 await,所以 startChatSend 返回时 queued 已经确定。
 */
export function startChatSend<T>(
  send: (onCreate: () => void) => Promise<T>,
): ChatSendHandle<T> {
  let queued = false;
  let delivered: Promise<T>;
  try {
    delivered = Promise.resolve(
      send(() => {
        queued = true;
      }),
    );
  } catch (error) {
    delivered = Promise.reject(error);
  }
  return { queued, delivered };
}
