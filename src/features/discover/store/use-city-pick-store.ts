import { create } from 'zustand';

/** 单选城市的入口：笔记标题里的城市、大众点评榜的城市筛选。 */
export type CityPickTarget = 'note' | 'ranking';

interface CityPickState {
  picked: Partial<Record<CityPickTarget, string>>;
  pick: (target: CityPickTarget, city: string) => void;
  /** 取走选择结果（只取一次），回到入口页时调用。 */
  consume: (target: CityPickTarget) => string | null;
}

/**
 * 城市选择页是独立路由，选完 router.back()，结果放在这里交还给入口页。
 * 和笔记定位选择同一个套路（use-note-location-picker-store）。
 */
export const useCityPickStore = create<CityPickState>((set, get) => ({
  picked: {},
  pick: (target, city) => set((state) => ({ picked: { ...state.picked, [target]: city } })),
  consume: (target) => {
    const city = get().picked[target] ?? null;
    if (city !== null) {
      set((state) => {
        const { [target]: _taken, ...rest } = state.picked;
        return { picked: rest };
      });
    }
    return city;
  },
}));
