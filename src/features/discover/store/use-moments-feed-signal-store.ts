import { create } from 'zustand';

/**
 * 朋友圈 feed 更新信号（#89）。
 *
 * 后端在好友发/删朋友圈时经实时通道推 'moments.feed.updated'（轻量 poke，
 * 不带内容），realtime client 收到后 bump 一次 version；feed 组件订阅
 * version 变化去拉一次新帖数 —— 取代原来的 30s 轮询。
 *
 * 纯内存信号，不持久化。version 只增不减，组件用「上次已处理的值」判新。
 */
interface MomentsFeedSignalState {
  version: number;
  bump: () => void;
}

export const useMomentsFeedSignalStore = create<MomentsFeedSignalState>(
  (set) => ({
    version: 0,
    bump: () => set((state) => ({ version: state.version + 1 })),
  }),
);
