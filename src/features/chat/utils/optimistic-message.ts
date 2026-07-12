export function stampOptimisticMessage<T extends { sendTime?: number }>(
  message: T,
  now: number,
): T {
  return Number.isFinite(message.sendTime) && (message.sendTime ?? 0) > 0
    ? message
    : { ...message, sendTime: now };
}
