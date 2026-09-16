import { useCallback, useEffect, useRef } from 'react';
import {
  readComposerDraft,
  useComposerDraftStore,
} from '@/chat-core/composer-drafts';
import { isLocalMessageId } from '@/chat-core/local-message-id';
import type { MentionTarget } from '@/features/chat/utils/chat-send-payloads';
import type { ChatMessage } from '@/types';

/** 打字期间攒一会儿再写 MMKV,不必每敲一个字写一次。 */
const DRAFT_SAVE_DELAY_MS = 400;

interface ComposerDraftBinding {
  userId: string | null;
  conversationId: string;
  draft: string;
  setDraft: (text: string) => void;
  mentionTargets: MentionTarget[];
  setMentionTargets: (targets: MentionTarget[]) => void;
  quoteTarget: ChatMessage | null;
  setQuoteTarget: (message: ChatMessage | null) => void;
  /** 当前时间线(引用目标要在里面找得到才还原)。 */
  messages: ChatMessage[];
  /** 正在编辑一条已发出的消息:输入框里是那条消息的原文,不是草稿。 */
  paused: boolean;
}

/**
 * 聊天输入框草稿的恢复与保存(按账号 + 会话,见 chat-core/composer-drafts)。
 *
 * 返回的 clearPersistedDraft 要在发送成功时立刻调用:只靠防抖保存「空草稿」的话,
 * 发完 400ms 内被杀进程,下次打开会话输入框里又是刚发出去的那段话。
 */
export function useComposerDraftPersistence({
  userId,
  conversationId,
  draft,
  setDraft,
  mentionTargets,
  setMentionTargets,
  quoteTarget,
  setQuoteTarget,
  messages,
  paused,
}: ComposerDraftBinding): { clearPersistedDraft: () => void } {
  const restoredKeyRef = useRef<string | null>(null);
  const pendingQuoteIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ draft, mentionTargets, quoteTarget, paused });
  latestRef.current = { draft, mentionTargets, quoteTarget, paused };
  const sessionKey = userId ? `${userId}:${conversationId}` : null;

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!userId || restoredKeyRef.current !== `${userId}:${conversationId}`) {
      return;
    }
    const latest = latestRef.current;
    if (latest.paused) return;
    const quoteId =
      latest.quoteTarget && !isLocalMessageId(latest.quoteTarget.id)
        ? latest.quoteTarget.id
        : pendingQuoteIdRef.current;
    useComposerDraftStore.getState().saveDraft(userId, conversationId, {
      text: latest.draft,
      quoteMessageId: quoteId,
      mentions: latest.mentionTargets.map((target) => ({
        userID: target.userID,
        nickname: target.nickname,
        ...(target.isAll ? { isAll: true } : {}),
      })),
    });
  }, [conversationId, userId]);

  // 进入会话(或会话/账号切换)时恢复一次。输入框里已经有内容(分享带进来的开场白等)
  // 时不覆盖。
  useEffect(() => {
    if (!sessionKey || restoredKeyRef.current === sessionKey) return;
    restoredKeyRef.current = sessionKey;
    pendingQuoteIdRef.current = null;
    const saved = readComposerDraft(userId, conversationId);
    if (!saved) return;
    if (latestRef.current.draft.length === 0 && saved.text.length > 0) {
      setDraft(saved.text);
      setMentionTargets(saved.mentions);
    }
    if (saved.quoteMessageId && !latestRef.current.quoteTarget) {
      pendingQuoteIdRef.current = saved.quoteMessageId;
    }
  }, [conversationId, sessionKey, setDraft, setMentionTargets, userId]);

  // 引用目标要等历史页加载进来才找得到。
  useEffect(() => {
    const wanted = pendingQuoteIdRef.current;
    if (!wanted || quoteTarget) return;
    const found = messages.find((message) => message.id === wanted);
    if (!found) return;
    pendingQuoteIdRef.current = null;
    setQuoteTarget(found);
  }, [messages, quoteTarget, setQuoteTarget]);

  useEffect(() => {
    if (!sessionKey || restoredKeyRef.current !== sessionKey || paused) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushSave();
    }, DRAFT_SAVE_DELAY_MS);
  }, [draft, flushSave, mentionTargets, paused, quoteTarget, sessionKey]);

  // 离开会话:把还在防抖里的那一次立刻写掉。
  useEffect(() => () => flushSave(), [flushSave]);

  const clearPersistedDraft = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingQuoteIdRef.current = null;
    if (userId) {
      useComposerDraftStore.getState().clearDraft(userId, conversationId);
    }
  }, [conversationId, userId]);

  return { clearPersistedDraft };
}
