import { create } from 'zustand';
import { fetchCircles, fetchMyCircles } from '@/services/api/circles';
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

  // force：变更后（建圈/退圈等）绕过在飞合并强制重拉 —— 否则可能 await 到
  // 变更前就出发的快照。
  fetchMyCircles: (options?: { force?: boolean }) => Promise<void>;
  fetchAllCircles: (options?: { force?: boolean }) => Promise<void>;
  // Patch one circle across every cached list (avatar/cover changes from the
  // detail screen, etc.) so lists don't show stale data until the next refetch.
  patchCircle: (id: string, patch: Partial<Circle>) => void;
  removeCircle: (id: string) => void;
  reset: () => void;
}

// 单飞句柄（#106）：plaza-feed 与 SelectCircleScreen 都会在 mount 时触发同一份
// 拉取，旧实现无防重入（并发 last-write-wins），且 fetchMyCircles 会在 await 前
// 先清空四个列表 —— 第二个并发调用让已渲染的列表闪空。改为：并发调用合并进同一个
// Promise；列表不预清，旧数据保留到新响应落地。
// review 修复（P1）：句柄+代际双守卫。reset()（登出/切号）与 force（变更后
// 重拉）都推进代际 —— 陈旧在飞请求的响应落地时代际不匹配、写入被丢弃；
// 否则 A 号的在飞 /circle/my 会把 A 的圈子写进 B 号的 store，建圈后的
// await 也可能等到建圈前的快照。
let myCirclesInFlight: Promise<void> | null = null;
let allCirclesInFlight: Promise<void> | null = null;
let myCirclesRunSeq = 0;
let allCirclesRunSeq = 0;

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

  fetchMyCircles: (options = {}) => {
    if (myCirclesInFlight && !options.force) {
      return myCirclesInFlight;
    }
    const runId = ++myCirclesRunSeq;
    // 只有最新代际的运行可写 store；reset()/force 之后陈旧响应静默丢弃。
    const guardedSet: typeof set = (partial) => {
      if (runId === myCirclesRunSeq) set(partial);
    };
    const run = (async () => {
      guardedSet({ myCirclesLoading: true, myCirclesError: null });
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
        // joined 项自带 myRole（GET /circle/my 直接返回），无需逐个拉圈子详情。
        const managedCircles = deriveManagedCircles({
          createdCircles: created,
          joinedCircles: joinedCandidates,
        });

        guardedSet({
          joinedCircles: joined,
          createdCircles: created,
          managedCircles,
          appliedCircles: applied,
          myCirclesError: null,
        });
      } catch (error) {
        guardedSet({
          myCirclesError: getApiErrorMessage(
            error,
            '加载圈子列表失败，请稍后重试',
          ),
        });
      } finally {
        guardedSet({ myCirclesLoading: false });
      }
    })().finally(() => {
      if (myCirclesInFlight === run) {
        myCirclesInFlight = null;
      }
    });
    myCirclesInFlight = run;
    return run;
  },

  fetchAllCircles: (options = {}) => {
    if (allCirclesInFlight && !options.force) {
      return allCirclesInFlight;
    }
    const runId = ++allCirclesRunSeq;
    const guardedSet: typeof set = (partial) => {
      if (runId === allCirclesRunSeq) set(partial);
    };
    const run = (async () => {
      guardedSet({ allCirclesLoading: true, allCirclesError: null });
      try {
        const result = await fetchCircles({ limit: ALL_CIRCLES_LIMIT });
        if (result.total > result.items.length) {
          logClientDiagnostic('circle_discover_list_capped', {
            total: result.total,
            loaded: result.items.length,
            limit: ALL_CIRCLES_LIMIT,
          });
        }
        guardedSet({
          allCircles: result.items,
          allCirclesTotal: result.total,
          allCirclesError: null,
        });
      } catch (error) {
        guardedSet({
          allCirclesError: getApiErrorMessage(
            error,
            '加载圈子筛选失败，请稍后重试',
          ),
        });
      } finally {
        guardedSet({ allCirclesLoading: false });
      }
    })().finally(() => {
      if (allCirclesInFlight === run) {
        allCirclesInFlight = null;
      }
    });
    allCirclesInFlight = run;
    return run;
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

  removeCircle: (id) => {
    // round 2 review：成员关系已变更 —— 变更**前**出发的在飞 /circle/my
    // 快照必须作废（推进代际 + 清句柄）。否则退圈后返回广场，focus 刷新
    // 合并进旧在飞请求，把刚退掉的圈子又写回列表。
    myCirclesRunSeq += 1;
    myCirclesInFlight = null;
    set((state) => {
      const remove = (list: Circle[]) =>
        list.filter((circle) => circle.id !== id);
      return {
        joinedCircles: remove(state.joinedCircles),
        createdCircles: remove(state.createdCircles),
        managedCircles: remove(state.managedCircles),
        appliedCircles: remove(state.appliedCircles),
        allCircles: remove(state.allCircles),
        // round 3 review：被作废的在飞请求再也走不到它的 guardedSet finally
        // —— loading 不清会让没有后续 focus 刷新的面板永远转圈。
        myCirclesLoading: false,
      };
    });
  },

  reset: () => {
    // review 修复（P1）：登出/切号必须让在飞请求整体失效 —— 推进代际使其
    // 落地写入被丢弃，并清句柄让下一个会话的 fetch 重新起飞（而不是复用
    // 上一个账号的在飞请求）。
    myCirclesRunSeq += 1;
    allCirclesRunSeq += 1;
    myCirclesInFlight = null;
    allCirclesInFlight = null;
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
    });
  },
}));
