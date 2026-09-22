import { useMemo } from 'react';
import { type ThemeColors } from '@/theme';

export interface ChatDetailThemedStylesParams {
  colors: ThemeColors;
  backgroundStyle: { backgroundColor: string };
  statusColor: string;
}

/**
 * 随主题、聊天背景与对端在线状态变化的样式(静态部分在 chat-detail/styles)。
 */
export function useChatDetailThemedStyles({
  colors,
  backgroundStyle,
  statusColor,
}: ChatDetailThemedStylesParams) {
  const d = useMemo(() => ({
    container: { flex: 1, backgroundColor: colors.background },
    messageArea: { backgroundColor: backgroundStyle.backgroundColor },
    headerName: { color: colors.text },
    onlineDot: { backgroundColor: statusColor },
    headerStatusText: { color: statusColor },
    inputBar: { backgroundColor: colors.background },
    disappearingMessageNotice: { backgroundColor: colors.primaryLight },
    disappearingMessageNoticeText: { color: colors.text },
    silencedBar: { backgroundColor: colors.surface },
    silencedBarText: { color: colors.textSecondary },
    circleBtn: { backgroundColor: colors.surface },
    composerActionBtn: { backgroundColor: colors.surfaceBorder },
    composerShell: { backgroundColor: colors.inputBg, borderColor: colors.surfaceBorder },
    composerInput: { color: colors.text },
    attachmentPanel: { backgroundColor: colors.background },
    attachmentDragBar: { backgroundColor: colors.surfaceBorder },
    attachmentIcon: { backgroundColor: colors.surface },
    voiceHoldBarIdle: {
      backgroundColor: colors.inputBg,
      borderColor: colors.surfaceBorder,
    },
    voiceHoldBarActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    targetMessageHighlight: { backgroundColor: colors.primaryLight },
  }), [backgroundStyle.backgroundColor, colors, statusColor]);

  return {
    d,
  };
}

export type ChatDetailThemedStyles = ReturnType<typeof useChatDetailThemedStyles>['d'];
