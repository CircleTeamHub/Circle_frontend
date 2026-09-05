type HeightCarrier = { height?: unknown };

export function getKnownClearTargetHeight(
  conversation: { lastMessage?: HeightCarrier | null } | undefined,
  messages: readonly HeightCarrier[],
): number | undefined {
  const heights = [
    conversation?.lastMessage?.height,
    ...messages.map((message) => message.height),
    // 真实高度从 1 开始（服务端落库用 nextHeight + 1）。0 只会来自还没拿到
    // 回执的乐观消息，把它当成水位会让服务端按 `clearThrough <= 0` 一条都不清。
  ].filter(
    (height): height is number =>
      Number.isSafeInteger(height) && (height as number) >= 1,
  );
  if (heights.length === 0) return undefined;
  return Math.max(...heights);
}
