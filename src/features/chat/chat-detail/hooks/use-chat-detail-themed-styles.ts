import { useMemo } from 'react';
import { type ThemeColors } from '@/theme';

export interface ChatDetailThemedStylesParams {
  colors: ThemeColors;
  backgroundStyle: { backgroundColor: string };
}

/**
 * 随主题与聊天背景变化的样式(静态部分在 chat-detail/styles)。
 */
export function useChatDetailThemedStyles({
  colors,
  backgroundStyle,
}: ChatDetailThemedStylesParams) {
  const d = useMemo(() => ({
    container: { flex: 1, backgroundColor: colors.background },
    messageArea: { backgroundColor: backgroundStyle.backgroundColor },
    unreadJumpButton: {
      backgroundColor: colors.surface,
      borderColor: colors.surfaceBorder,
    },
    unreadJumpText: { color: colors.success },
    inputBar: { backgroundColor: 'transparent' },
    disappearingMessageNoticeText: { color: colors.text },
    silencedBar: { backgroundColor: colors.surface },
    silencedBarText: { color: colors.text },
    composerShell: { backgroundColor: colors.inputBg, borderColor: colors.surfaceBorder },
    composerInput: { color: colors.text },
    attachmentPanel: { backgroundColor: colors.background },
    attachmentDragBar: { backgroundColor: colors.surfaceBorder },
    attachmentIcon: { backgroundColor: colors.surface },
    voiceHoldBarIdle: {
      backgroundColor: 'transparent',
    },
    voiceHoldBarActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    targetMessageHighlight: { backgroundColor: colors.primaryLight },
  }), [backgroundStyle.backgroundColor, colors]);

  return {
    d,
  };
}

export type ChatDetailThemedStyles = ReturnType<typeof useChatDetailThemedStyles>['d'];
