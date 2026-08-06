import { create } from 'zustand';
import type { ChatMessageDto } from '@/chat-core/protocol';
import type { ChatMessage } from '@/types';

type PendingForward = {
  message: ChatMessage;
  // 源消息的 chat-core DTO(content 里有媒体 object key / 卡片 payload 本体)。
  // 有它就能原样重发媒体与卡片;缺失(极端竞态)时选择器退化为文本转发。
  dto?: ChatMessageDto;
};

interface MessageForwardState {
  pending: PendingForward | null;
  setPending: (item: PendingForward) => void;
  clear: () => void;
}

export const useMessageForwardStore = create<MessageForwardState>((set) => ({
  pending: null,
  setPending: (item) => set({ pending: item }),
  clear: () => set({ pending: null }),
}));
