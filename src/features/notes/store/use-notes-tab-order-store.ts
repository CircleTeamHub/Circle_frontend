import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

/**
 * 「我的笔记」tab 顺序(含固定 tab「全部/未分组」的位置)。
 * 分组之间的相对顺序由服务端 sortOrder 承载;固定 tab 没有服务端行,
 * 整条顺序在本地持久化,渲染时经 mergeTabOrder 与服务端分组对齐。
 */
interface NotesTabOrderState {
  orderIds: string[];
  setOrderIds: (ids: string[]) => void;
}

export const useNotesTabOrderStore = create<NotesTabOrderState>()(
  persist(
    (set) => ({
      orderIds: [],
      setOrderIds: (ids) => set({ orderIds: ids }),
    }),
    {
      name: 'circle-im-notes-tab-order',
      storage: createJSONStorage(() => mmkvJsonStorage),
    },
  ),
);
