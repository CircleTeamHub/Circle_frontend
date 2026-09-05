type HeightCarrier = { height?: unknown };

export function getKnownClearTargetHeight(
  conversation: { lastMessage?: HeightCarrier | null } | undefined,
  messages: readonly HeightCarrier[],
): number | undefined {
  const heights = [
    conversation?.lastMessage?.height,
    ...messages.map((message) => message.height),
  ].filter(
    (height): height is number =>
      Number.isSafeInteger(height) && (height as number) >= 0,
  );
  if (heights.length === 0) return undefined;
  return Math.max(...heights);
}
