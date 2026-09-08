import { create } from 'zustand';
import { fetchMyCircles } from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import type { Circle } from '@/types';
import { deriveManagedCircles } from './managed-circles';

// fetchMyCircles 的「本次 run 快照」——即便随后被更新代际（force/reset）取代、
// guardedSet 写入被丢弃，调用方拿到的仍是这次请求自己的权威结果。
export type MyCirclesFetchResult = {
  ok: boolean;
  joined: Circle[];
  created: Circle[];
};

interface CirclesState {
  joinedCircles: Circle[];
  createdCircles: Circle[];
  managedCircles: Circle[];
  appliedCircles: Circle[];
  myCirclesLoading: boolean;
  myCirclesError: string | null;

  // force：变更后（建圈/退圈等）绕过在飞合并强制重拉 —— 否则可能 await 到
  // 变更前就出发的快照。
  fetchMyCircles: (options?: {
    force?: boolean;
  }) => Promise<MyCirclesFetchResult>;
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
let myCirclesInFlight: Promise<MyCirclesFetchResult> | null = null;
let myCirclesRunSeq = 0;

export const useCirclesStore = create<CirclesState>((set) => ({
  joinedCircles: [],
  createdCircles: [],
  managedCircles: [],
  appliedCircles: [],
  myCirclesLoading: false,
  myCirclesError: null,

  fetchMyCircles: (options = {}) => {
    if (myCirclesInFlight && !options.force) {
      return myCirclesInFlight;
    }
    const runId = ++myCirclesRunSeq;
    // 只有最新代际的运行可写 store；reset()/force 之后陈旧响应静默丢弃。
    const guardedSet: typeof set = (partial) => {
      if (runId === myCirclesRunSeq) set(partial);
    };
    const run = (async (): Promise<MyCirclesFetchResult> => {
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
        // 返回本次 run 的快照 —— 调用方（如发帖提交前校验）据此判断，不必回读 store，
        // 从而不受并发 force/reset 代际覆盖的影响。
        return { ok: true, joined, created };
      } catch (error) {
        guardedSet({
          myCirclesError: getApiErrorMessage(
            error,
            '加载圈子列表失败，请稍后重试',
          ),
        });
        return { ok: false, joined: [], created: [] };
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
    myCirclesInFlight = null;
    set({
      joinedCircles: [],
      createdCircles: [],
      managedCircles: [],
      appliedCircles: [],
      myCirclesLoading: false,
      myCirclesError: null,
    });
  },
}));
