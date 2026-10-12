import { reportHandledFailure } from '@/observability/report-failure';
import { fetchNoteSourceStates, type NoteSourceState } from '@/services/api/notes';
import type { NoteCardData } from '@/types';

type StatusFields = Pick<NoteCardData, 'noteId' | 'workStatus' | 'publicationStatus'>;

/** 把服务端返回的实时状态合并进卡片；没有对应结果的卡片原样返回。 */
export function mergeNoteSourceStates<T extends StatusFields>(
  cards: readonly T[],
  states: readonly NoteSourceState[],
): T[] {
  const byId = new Map(states.map((state) => [state.noteId, state]));
  return cards.map((card) => {
    const state = byId.get(card.noteId);
    if (!state) return card;
    if (
      card.workStatus === state.workStatus &&
      card.publicationStatus === state.publicationStatus
    ) {
      return card;
    }
    return {
      ...card,
      workStatus: state.workStatus,
      publicationStatus: state.publicationStatus,
    };
  });
}

/**
 * 发送前的提醒必须基于来源笔记**当前**的状态：卡片/弹层里的状态是打开时的
 * 快照，期间老板可能已打烊或下架。取不到（离线等）时退回原快照，提醒仍按
 * 已知状态给出，不阻断发送——真正写进消息的状态由服务端按实时状态盖章。
 */
export async function withFreshNoteSourceStatus<T extends StatusFields>(
  cards: readonly T[],
): Promise<T[]> {
  if (cards.length === 0) return [...cards];
  try {
    const states = await fetchNoteSourceStates(cards.map((card) => card.noteId));
    return mergeNoteSourceStates(cards, states);
  } catch (error) {
    reportHandledFailure('noteCardStatus', 'fetchSourceStates', error, {
      count: cards.length,
    });
    return [...cards];
  }
}
