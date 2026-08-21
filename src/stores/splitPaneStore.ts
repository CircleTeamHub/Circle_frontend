import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
import {
  SPLIT_LIST_PANE_MAX_WIDTH,
  SPLIT_LIST_PANE_MIN_WIDTH,
  SPLIT_LIST_PANE_WIDTH,
} from '@/hooks/use-desktop-split-layout';

/**
 * 桌面网页版分栏的左栏宽度（用户可拖分割线调整）。
 *
 * 单独立一个 store 而不是各屏自持：会话列表与浮动 tab 条都要按同一个宽度
 * 落位，拖动时必须同帧一致。持久化到本地（web 上即 localStorage），
 * 下次打开保持用户调好的宽度。
 */
type SplitPaneState = {
  listPaneWidth: number;
  setListPaneWidth: (width: number) => void;
  resetListPaneWidth: () => void;
};

export function clampListPaneWidth(width: number): number {
  if (!Number.isFinite(width)) return SPLIT_LIST_PANE_WIDTH;
  return Math.max(
    SPLIT_LIST_PANE_MIN_WIDTH,
    Math.min(SPLIT_LIST_PANE_MAX_WIDTH, Math.round(width)),
  );
}

export const useSplitPaneStore = create<SplitPaneState>()(
  persist(
    (set) => ({
      listPaneWidth: SPLIT_LIST_PANE_WIDTH,
      setListPaneWidth: (width) =>
        set({ listPaneWidth: clampListPaneWidth(width) }),
      resetListPaneWidth: () => set({ listPaneWidth: SPLIT_LIST_PANE_WIDTH }),
    }),
    {
      name: 'circle-im-split-pane',
      storage: createJSONStorage(() => mmkvJsonStorage),
      // 存过的旧值也要过一遍夹取：上限/下限改动后不能把窗口挤坏。
      merge: (persisted, current) => {
        const saved = persisted as Partial<SplitPaneState> | undefined;
        return {
          ...current,
          listPaneWidth: clampListPaneWidth(
            saved?.listPaneWidth ?? SPLIT_LIST_PANE_WIDTH,
          ),
        };
      },
    },
  ),
);
