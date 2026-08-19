import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
import { clampCircleFilterIds } from '@/features/discover/utils/circle-filter-selection';

interface DiscoverFilterState {
  appliedCircleIds: string[];
  appliedCities: string[];
  // 「全国」= 不限地区、展示全部（筛选行为与「未选择」一致，cities 保持为空、不参与筛选）。
  // 单独用布尔标记记住用户「显式选了全国」，仅用于筛选页回显，避免把哨兵城市塞进 cities 数组
  // 后每个下游消费者都要记得剔除。
  appliedNationwide: boolean;
  draftCircleIds: string[];
  draftCities: string[];
  draftNationwide: boolean;

  loadDraftFromApplied: () => void;
  setDraftCircleIds: (ids: string[]) => void;
  setDraftCities: (cities: string[]) => void;
  setDraftNationwide: (value: boolean) => void;
  removeDraftCircle: (id: string) => void;
  removeDraftCity: (city: string) => void;
  clearDraft: () => void;
  saveFilter: () => void;
  // 已生效的筛选是全局的（广场 + 我的圈子列表都读它）。列表页要能就地清掉它，
  // 否则筛选只在广场可见、却在别处静默隐藏条目。
  clearAppliedFilter: () => void;
  // 登出 teardown 用（#97）：appliedCircleIds 引用账号的圈子，不得跨号残留。
  resetForLogout: () => void;
}

export const useDiscoverFilterStore = create<DiscoverFilterState>()(
  persist(
    (set, get) => ({
      appliedCircleIds: [],
      appliedCities: [],
      appliedNationwide: false,
      draftCircleIds: [],
      draftCities: [],
      draftNationwide: false,

      loadDraftFromApplied: () => {
        const { appliedCircleIds, appliedCities, appliedNationwide } = get();
        set({
          draftCircleIds: clampCircleFilterIds(appliedCircleIds),
          draftCities: [...appliedCities],
          draftNationwide: appliedNationwide,
        });
      },

      setDraftCircleIds: (ids) =>
        set({ draftCircleIds: clampCircleFilterIds(ids) }),
      // 选了具体城市 = 退出「全国」，二者互斥。
      setDraftCities: (cities) =>
        set({ draftCities: cities, draftNationwide: false }),
      // 选「全国」= 不限地区，清掉已选城市。
      setDraftNationwide: (value) =>
        set((state) => ({
          draftNationwide: value,
          draftCities: value ? [] : state.draftCities,
        })),

      removeDraftCircle: (id) =>
        set((state) => ({
          draftCircleIds: state.draftCircleIds.filter((value) => value !== id),
        })),

      removeDraftCity: (city) =>
        set((state) => ({
          draftCities: state.draftCities.filter((value) => value !== city),
        })),

      clearDraft: () =>
        set({ draftCircleIds: [], draftCities: [], draftNationwide: false }),

      saveFilter: () => {
        const { draftCircleIds, draftCities, draftNationwide } = get();
        set({
          appliedCircleIds: clampCircleFilterIds(draftCircleIds),
          appliedCities: [...draftCities],
          appliedNationwide: draftNationwide,
        });
      },

      clearAppliedFilter: () =>
        set({
          appliedCircleIds: [],
          appliedCities: [],
          appliedNationwide: false,
          draftCircleIds: [],
          draftCities: [],
          draftNationwide: false,
        }),

      resetForLogout: () =>
        set({
          appliedCircleIds: [],
          appliedCities: [],
          appliedNationwide: false,
          draftCircleIds: [],
          draftCities: [],
          draftNationwide: false,
        }),
    }),
    {
      name: 'circle-im-discover-filter',
      storage: createJSONStorage(() => mmkvJsonStorage),
      partialize: (state) => ({
        appliedCircleIds: state.appliedCircleIds,
        appliedCities: state.appliedCities,
        appliedNationwide: state.appliedNationwide,
      }),
    },
  ),
);
