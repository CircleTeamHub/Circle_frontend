import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
import {
  isEmptyComposerDraft,
  pruneComposerDrafts,
  type ComposerDraft,
} from './composer-draft-model';

export type { ComposerDraft, ComposerDraftMention } from './composer-draft-model';

/**
 * 聊天输入框草稿(按账号 + 会话持久化)。
 *
 * 原来草稿只是聊天页里的 useState:返回会话列表、切到别的会话、App 被杀,打了一半的
 * 话就没了,会话列表上也看不出哪里还有没发的内容。现在落 MMKV,会话列表显示
 * 「[草稿]」(微信同款)。
 *
 * 草稿是没发出去的消息原文,随账号走:登出时由 services/auth/session.ts 的
 * 账号级清理清单清掉(#97)。仍按账号分桶,是为了挡住登出被新会话抢占时
 * 旧账号迟到的那次保存 —— 写进的是旧账号的桶,新账号读不到。
 */
interface ComposerDraftState {
  draftsByUser: Record<string, Record<string, ComposerDraft>>;
  saveDraft: (
    userId: string,
    conversationId: string,
    draft: Omit<ComposerDraft, 'updatedAt'>,
  ) => void;
  clearDraft: (userId: string, conversationId: string) => void;
  resetForLogout: () => void;
}

export const useComposerDraftStore = create<ComposerDraftState>()(
  persist(
    (set, get) => ({
      draftsByUser: {},
      saveDraft: (userId, conversationId, input) => {
        const next: ComposerDraft = { ...input, updatedAt: Date.now() };
        if (isEmptyComposerDraft(next)) {
          get().clearDraft(userId, conversationId);
          return;
        }
        const { draftsByUser } = get();
        const current = draftsByUser[userId]?.[conversationId];
        if (
          current &&
          current.text === next.text &&
          current.quoteMessageId === next.quoteMessageId &&
          JSON.stringify(current.mentions) === JSON.stringify(next.mentions)
        ) {
          return;
        }
        set({
          draftsByUser: {
            ...draftsByUser,
            [userId]: pruneComposerDrafts({
              ...(draftsByUser[userId] ?? {}),
              [conversationId]: next,
            }),
          },
        });
      },
      clearDraft: (userId, conversationId) => {
        const { draftsByUser } = get();
        const drafts = draftsByUser[userId];
        if (!drafts || !(conversationId in drafts)) return;
        const { [conversationId]: _removed, ...rest } = drafts;
        set({ draftsByUser: { ...draftsByUser, [userId]: rest } });
      },
      resetForLogout: () => set({ draftsByUser: {} }),
    }),
    {
      name: 'circle-im-chat-composer-drafts',
      storage: createJSONStorage(() => mmkvJsonStorage),
      partialize: (state) => ({ draftsByUser: state.draftsByUser }),
    },
  ),
);

export function readComposerDraft(
  userId: string | null,
  conversationId: string,
): ComposerDraft | null {
  if (!userId) return null;
  return (
    useComposerDraftStore.getState().draftsByUser[userId]?.[conversationId] ??
    null
  );
}
