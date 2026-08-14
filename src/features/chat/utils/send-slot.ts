/** 等发送位（inFlightRef）空出来时的默认上限与轮询间隔。 */
export const SEND_SLOT_WAIT_TIMEOUT_MS = 15_000;
export const SEND_SLOT_POLL_MS = 100;

export interface WaitForSendSlotOptions {
  isBusy: () => boolean;
  isMounted: () => boolean;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

/**
 * 等到发送位空出来。
 *
 * 存在的理由：从选点页回来时，位置已经在 focus effect 里被**消费掉**了（store
 * 里不再有）。这时如果正好有另一发在飞，直接 return 就是把用户选的点悄悄丢了：
 * 不发、不报错、也没法重来。所以这里等它结束再发；等不到就返回 false，由调用方
 * 显式报错，至少让用户知道要重选。
 */
export async function waitForSendSlot({
  isBusy,
  isMounted,
  timeoutMs = SEND_SLOT_WAIT_TIMEOUT_MS,
  pollMs = SEND_SLOT_POLL_MS,
  now = Date.now,
  wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: WaitForSendSlotOptions): Promise<boolean> {
  const deadline = now() + timeoutMs;
  while (isBusy()) {
    // 组件已经卸载：不再等，也不该继续往一个走掉的会话里发。
    if (!isMounted()) return false;
    if (now() >= deadline) return false;
    await wait(pollMs);
  }
  return isMounted();
}
