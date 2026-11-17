import { create } from 'zustand';

/**
 * 聊天里笔记卡片「视频 / 展示 / 位置」正在发送的分块:noteSectionSendKey → 进行中的次数
 * (叠着的两个聊天页可能同时在发同一块,所以计数而不是布尔)。
 *
 * 发送端(useNoteBatchSend)登记,卡片自己订阅来画「发送中」。不经消息列表的渲染函数下发:
 * 那样每点一次,整屏消息行都要重渲染。
 */
interface NoteSectionSendState {
  sending: Readonly<Record<string, number>>;
  begin: (key: string) => void;
  end: (key: string) => void;
}

export const useNoteSectionSendStore = create<NoteSectionSendState>((set) => ({
  sending: {},
  begin: (key) =>
    set((state) => ({
      sending: { ...state.sending, [key]: (state.sending[key] ?? 0) + 1 },
    })),
  end: (key) =>
    set((state) => {
      const { [key]: count = 0, ...rest } = state.sending;
      return { sending: count > 1 ? { ...rest, [key]: count - 1 } : rest };
    }),
}));
