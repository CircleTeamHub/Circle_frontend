import { create } from 'zustand';
import {
  fetchCircleDetail,
  fetchCircles,
  fetchMyCircles,
} from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import type { Circle } from '@/types';
import { deriveManagedCircles } from './managed-circles';

// 「发现圈子」一次最多拉取的圈子数。本地搜索只在这批里过滤，超出部分搜不到——
// total 超过它时记一条诊断并由 UI 提示，避免「搜了真实存在的圈子却查无结果」的静默错误。
const ALL_CIRCLES_LIMIT = 100;

interface CirclesState {
  joinedCircles: Circle[];
  createdCircles: Circle[];
  managedCircles: Circle[];
  appliedCircles: Circle[];
  allCircles: Circle[];
  // 服务端报告的圈子总数；> allCircles.length 时说明列表被 limit 截断。
  allCirclesTotal: number;
  myCirclesLoading: boolean;
  allCirclesLoading: boolean;
  myCirclesError: string | null;
  allCirclesError: string | null;

  fetchMyCircles: () => Promise<void>;
  fetchAllCircles: () => Promise<void>;
  // Patch one circle across every cached list (avatar/cover changes from the
  // detail screen, etc.) so lists don't show stale data until the next refetch.
  patchCircle: (id: string, patch: Partial<Circle>) => void;
  removeCircle: (id: string) => void;
  reset: () => void;
}

export const useCirclesStore = create<CirclesState>((set) => ({
  joinedCircles: [],
  createdCircles: [],
  managedCircles: [],
  appliedCircles: [],
  allCircles: [],
  allCirclesTotal: 0,
  myCirclesLoading: false,
  allCirclesLoading: false,
  myCirclesError: null,
  allCirclesError: null,

  fetchMyCircles: async () => {
    set({
      joinedCircles: [],
      createdCircles: [],
      managedCircles: [],
      appliedCircles: [],
      myCirclesLoading: true,
      myCirclesError: null,
    });
    try {
      const [joined, created, applied] = await Promise.all([
        fetchMyCircles('joined'),
        fetchMyCircles('created'),
        fetchMyCircles('applied'),
      ]);
      const createdCircleIds = new Set(created.map((circle) => circle.id));
      const joinedCandidates = joined.filter(
        (circle) => !createdCircleIds.has(circle.id),
      );
      const joinedCircleDetails = await Promise.allSettled(
        joinedCandidates.map((circle) => fetchCircleDetail(circle.id)),
      );
      const managedCircles = deriveManagedCircles({
        createdCircles: created,
        joinedCircles: joinedCandidates,
        joinedCircleDetails: joinedCircleDetails.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        ),
      });

      set({
        joinedCircles: joined,
        createdCircles: created,
        managedCircles,
        appliedCircles: applied,
        myCirclesError: null,
      });
    } catch (error) {
      set({
        myCirclesError: getApiErrorMessage(
          error,
          '加载圈子列表失败，请稍后重试',
        ),
      });
    } finally {
      set({ myCirclesLoading: false });
    }
  },

  fetchAllCircles: async () => {
    set({ allCirclesLoading: true, allCirclesError: null });
    try {
      const result = await fetchCircles({ limit: ALL_CIRCLES_LIMIT });
      if (result.total > result.items.length) {
        logClientDiagnostic('circle_discover_list_capped', {
          total: result.total,
          loaded: result.items.length,
          limit: ALL_CIRCLES_LIMIT,
        });
      }
      set({
        allCircles: result.items,
        allCirclesTotal: result.total,
        allCirclesError: null,
      });
    } catch (error) {
      set({
        allCirclesError: getApiErrorMessage(
          error,
          '加载圈子筛选失败，请稍后重试',
        ),
      });
    } finally {
      set({ allCirclesLoading: false });
    }
  },

  patchCircle: (id, patch) =>
    set((state) => {
      const apply = (list: Circle[]) =>
        list.map((circle) =>
          circle.id === id ? { ...circle, ...patch } : circle,
        );
      return {
        joinedCircles: apply(state.joinedCircles),
        createdCircles: apply(state.createdCircles),
        managedCircles: apply(state.managedCircles),
        appliedCircles: apply(state.appliedCircles),
        allCircles: apply(state.allCircles),
      };
    }),

  removeCircle: (id) =>
    set((state) => {
      const remove = (list: Circle[]) =>
        list.filter((circle) => circle.id !== id);
      return {
        joinedCircles: remove(state.joinedCircles),
        createdCircles: remove(state.createdCircles),
        managedCircles: remove(state.managedCircles),
        appliedCircles: remove(state.appliedCircles),
        allCircles: remove(state.allCircles),
      };
    }),

  reset: () =>
    set({
      joinedCircles: [],
      createdCircles: [],
      managedCircles: [],
      appliedCircles: [],
      allCircles: [],
      allCirclesTotal: 0,
      myCirclesLoading: false,
      allCirclesLoading: false,
      myCirclesError: null,
      allCirclesError: null,
    }),
}));
