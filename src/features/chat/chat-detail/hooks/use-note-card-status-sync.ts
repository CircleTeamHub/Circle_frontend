import { useEffect, useMemo, useRef } from 'react';
import { useChatStore } from '@/chat-core/store';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { useNoteStatusSignalStore } from '@/features/notes/store/use-note-status-signal-store';
import { reportHandledFailure } from '@/observability/report-failure';
import {
  fetchNoteSourceStates,
  NOTE_SOURCE_STATES_MAX,
} from '@/services/api/notes';

/** 从最新往前收集会话里笔记卡片的 noteId，去重后最多一批。 */
export function collectNoteCardIds(
  messages: readonly ChatMessageDto[] | undefined,
  limit = NOTE_SOURCE_STATES_MAX,
): string[] {
  if (!messages || messages.length === 0) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type !== 'note-card') continue;
    const noteId = message.content?.['noteId'];
    if (typeof noteId !== 'string' || noteId.length === 0 || seen.has(noteId)) {
      continue;
    }
    seen.add(noteId);
    ids.push(noteId);
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * 聊天卡片上的开工/打烊/下架是发送时的快照，实时事件只在在线时打补丁、且
 * 补丁只在内存里。断线期间漏掉的事件、以及冷启动后从本地库/历史恢复的卡片，
 * 都要在打开会话和每次重连恢复时按来源实时状态批量对账一次。
 */
export function useNoteCardStatusSync(
  conversationId: string | undefined,
  messages: readonly ChatMessageDto[] | undefined,
): void {
  const recoveryVersion = useNoteStatusSignalStore(
    (state) => state.recoveryVersion,
  );
  const targetsKey = useMemo(() => {
    const ids = collectNoteCardIds(messages);
    const sourceIdByNoteId = new Map<string, string>();
    for (const message of messages ?? []) {
      if (message.type !== 'note-card') continue;
      const noteId = message.content?.['noteId'];
      if (typeof noteId !== 'string' || !ids.includes(noteId)) continue;
      const sourceNoteId = message.content?.['sourceNoteId'];
      sourceIdByNoteId.set(
        noteId,
        typeof sourceNoteId === 'string' && sourceNoteId.length > 0
          ? sourceNoteId
          : noteId,
      );
    }
    return JSON.stringify(
      ids.map((noteId) => [noteId, sourceIdByNoteId.get(noteId) ?? noteId]),
    );
  }, [messages]);
  // 本会话、本恢复周期内已对账成功的 id；新加载出的卡片只补拉增量。
  const syncedRef = useRef<{ key: string; ids: Set<string> }>({
    key: '',
    ids: new Set(),
  });

  useEffect(() => {
    const targets = JSON.parse(targetsKey) as [string, string][];
    if (!conversationId || targets.length === 0) {
      // 切到空会话也要换代，令上一会话仍在途的响应失效。
      syncedRef.current = { key: '', ids: new Set() };
      return;
    }
    const epoch = `${conversationId}:${recoveryVersion}`;
    if (syncedRef.current.key !== epoch) {
      syncedRef.current = { key: epoch, ids: new Set() };
    }
    const synced = syncedRef.current;
    const pending = targets
      .map(([noteId]) => noteId)
      .filter((id) => !synced.ids.has(id));
    if (pending.length === 0) return;
    pending.forEach((id) => synced.ids.add(id));
    const sourceIdByNoteId = new Map(targets);
    const sourceVersionsAtRequest = useNoteStatusSignalStore.getState().sourceVersions;
    let active = true;
    let finished = false;

    void fetchNoteSourceStates(pending)
      .then((states) => {
        // 会话或恢复周期已经切换：旧请求不得覆盖新周期的权威对账结果。
        if (!active || syncedRef.current !== synced) return;
        finished = true;
        const apply = useChatStore.getState().applyNoteSourceStatus;
        const currentSourceVersions =
          useNoteStatusSignalStore.getState().sourceVersions;
        for (const state of states) {
          const sourceNoteId = sourceIdByNoteId.get(state.noteId) ?? state.noteId;
          if (
            (currentSourceVersions[sourceNoteId] ?? 0) !==
            (sourceVersionsAtRequest[sourceNoteId] ?? 0)
          ) {
            continue;
          }
          apply(
            state.noteId,
            state.workStatus === 'UNSET' ? null : state.workStatus,
            state.publicationStatus,
          );
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        finished = true;
        // 失败的 id 退出已对账集合，下次消息变化或重连时再试。
        if (syncedRef.current === synced) {
          pending.forEach((id) => synced.ids.delete(id));
        }
        reportHandledFailure('noteCardStatus', 'syncConversation', error, {
          count: pending.length,
        });
      });
    return () => {
      active = false;
      // 同一周期因 messages 变化而重跑时，让新 effect 重新认领这些 id。
      if (!finished && syncedRef.current === synced) {
        pending.forEach((id) => synced.ids.delete(id));
      }
    };
  }, [conversationId, recoveryVersion, targetsKey]);
}
