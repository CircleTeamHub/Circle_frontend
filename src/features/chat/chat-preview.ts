const CHAT_PREVIEW_FALLBACK_MESSAGES = [
  'OpenIM 仅支持 iOS/Android development build',
  'IM 连接尚未完成，请稍后重试',
];

export function shouldOpenChatPreview(error: unknown) {
  if (
    !error ||
    typeof error !== 'object' ||
    !('message' in error) ||
    typeof error.message !== 'string'
  ) {
    return false;
  }

  const { message } = error as { message: string };
  return CHAT_PREVIEW_FALLBACK_MESSAGES.some((fallback) =>
    message.includes(fallback),
  );
}
