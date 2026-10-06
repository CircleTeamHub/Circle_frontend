import {
  DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  resolveChatBackgroundStyle,
  resolveEffectiveChatBackgroundPreference,
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import { useMemo } from 'react';
import {
  useChatBackgroundImageSource,
} from '@/features/chat/hooks/use-chat-background-image-source';
import { type ThemeColors } from '@/theme';

export interface ChatBackgroundParams {
  colors: ThemeColors;
  conversationID: string;
}

/**
 * 聊天背景:本会话的背景偏好(没有就用全局偏好)解析成背景色与可直接绘制的图片地址。
 */
export function useChatBackground({
  colors,
  conversationID,
}: ChatBackgroundParams) {
  const backgroundPreference = useChatPreferencesStore(
    (state) =>
      state.backgroundsByConversationID[conversationID] ??
      DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  );
  const globalBackgroundPreference = useChatPreferencesStore(
    (state) => state.globalBackgroundPreference,
  );
  const backgroundStyle = useMemo(
    () =>
      resolveChatBackgroundStyle(
        resolveEffectiveChatBackgroundPreference(
          backgroundPreference,
          globalBackgroundPreference,
        ),
        colors.background,
      ),
    [backgroundPreference, colors.background, globalBackgroundPreference],
  );
  // 偏好里存的是文件名（`chat-bg:<name>`），能画的 uri 只能现取：原生要拼绝对
  // 路径（容器路径不保证跨重装稳定），web 要从 IndexedDB 取回图再建 object URL。
  const backgroundImageUri = useChatBackgroundImageSource(backgroundStyle.imageUri);

  return {
    backgroundStyle,
    backgroundImageUri,
  };
}
