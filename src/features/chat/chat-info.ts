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
    return '关闭';
  }

  if (burnDuration >= 60 && burnDuration % 60 === 0) {
    return `${burnDuration / 60}分钟`;
  }

  return `${burnDuration}秒`;
}

export function buildChatInfoState(
  conversation: ChatInfoConversation
): ChatInfoState {
  return {
    pinned: conversation?.isPinned === true,
    muted: conversation?.recvMsgOpt === 2,
    burnLabel: formatBurnLabel(conversation?.burnDuration),
  };
}
