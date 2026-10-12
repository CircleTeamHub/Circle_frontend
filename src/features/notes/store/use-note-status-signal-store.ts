import { create } from 'zustand';
import type { NoteStatus } from '@/features/notes/types';

/**
 * 笔记来源状态的轻量实时信号。
 *
 * realtime 通道只推送「来源笔记变了」的 poke，不把完整笔记内容塞进长连接。
 * 列表和详情页订阅 version 后各自重新拉取，服务端负责把收录副本的有效状态
 * 叠加到返回结果上。纯内存保存，登出或重连不需要迁移本地数据。
 */
export interface NoteSourceStatusChange {
  sourceNoteId: string;
  workStatus: 'WORKING' | 'CLOSED' | null;
  status: NoteStatus;
  available: boolean;
  changedAt: string;
}

interface NoteStatusSignalState {
  version: number;
  lastChange: NoteSourceStatusChange | null;
  bump: (change?: NoteSourceStatusChange) => void;
  reset: () => void;
}

export const useNoteStatusSignalStore = create<NoteStatusSignalState>((set) => ({
  version: 0,
  lastChange: null,
  bump: (change) =>
    set((state) => ({
      version: state.version + 1,
      ...(change ? { lastChange: change } : {}),
    })),
  reset: () => set({ version: 0, lastChange: null }),
}));
