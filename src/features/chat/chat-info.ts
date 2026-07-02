import i18n from '@/i18n';

type ChatInfoConversation = {
  isPinned?: boolean | null;
  recvMsgOpt?: number | null;
  burnDuration?: number | null;
} | null | undefined;

export type ChatInfoState = {
  pinned: boolean;
  muted: boolean;
  burnLabel: string;
};

function formatBurnLabel(burnDuration?: number | null) {
  if (!burnDuration) {
    return i18n.t('chat.disappearing.off', { defaultValue: '关闭' });
  }

  if (burnDuration >= 60 && burnDuration % 60 === 0) {
    return i18n.t('chat.disappearing.minutes', {
      duration: burnDuration / 60,
      defaultValue: '{{duration}}分钟',
    });
  }

  return i18n.t('chat.disappearing.seconds', {
    duration: burnDuration,
    defaultValue: '{{duration}}秒',
  });
}

export function buildChatInfoState(
  conversation: ChatInfoConversation
): ChatInfoState {
  return {
    pinned: conversation?.isPinned === true,
    muted: (conversation?.recvMsgOpt ?? 0) !== 0,
    burnLabel: formatBurnLabel(conversation?.burnDuration),
  };
}
