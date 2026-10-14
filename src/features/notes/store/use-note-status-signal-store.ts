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
  /** 每个根来源的事件版本，用于阻止较旧的 HTTP 对账结果覆盖实时事件。 */
  sourceVersions: Record<string, number>;
  /**
   * 只在「没有具体事件」的 bump 时前进（断线重连、冷启动恢复）。这期间漏掉的
   * 事件无法逐条补回，订阅方必须整页重拉权威状态，而不是等 lastChange。
   */
  recoveryVersion: number;
  lastChange: NoteSourceStatusChange | null;
  bump: (change?: NoteSourceStatusChange) => void;
  reset: () => void;
}

export const useNoteStatusSignalStore = create<NoteStatusSignalState>((set) => ({
  version: 0,
  sourceVersions: {},
  recoveryVersion: 0,
  lastChange: null,
  bump: (change) =>
    set((state) => {
      const version = state.version + 1;
      return {
        version,
        ...(change
          ? {
              lastChange: change,
              sourceVersions: {
                ...state.sourceVersions,
                [change.sourceNoteId]: version,
              },
            }
          : { recoveryVersion: state.recoveryVersion + 1 }),
      };
    }),
  reset: () =>
    set({ version: 0, sourceVersions: {}, recoveryVersion: 0, lastChange: null }),
}));
