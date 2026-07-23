import { useEffect } from 'react';
import { create } from 'zustand';
import { fetchVipLevels } from '@/services/api/users';

/**
 * userId → vipLevel 的客户端缓存（会员名字特效用）。
 *
 * 各列表（通讯录 / 聊天 / 动态 / 通知）渲染名字时按 userId 请求，本 store 合并去重、
 * 防抖后一次批量拉取 `POST /user/vip-levels`，回来后订阅的组件自动重渲染、名字亮起。
 *
 * 只有 `levels` 需要响应式；pending / requested 是内部批处理簿记，放模块级可变集合，
 * 不进 store 状态，避免无谓的重渲染。
 */
interface UserVipState {
  levels: Record<string, number>;
}

export const useUserVipStore = create<UserVipState>(() => ({ levels: {} }));

const BATCH_DELAY_MS = 60;
const MAX_IDS_PER_REQUEST = 200;

// 已请求过的 id（在途或已回）——避免重复请求；请求失败会从中移除以便后续重试。
const requested = new Set<string>();
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  flushTimer = null;
  const ids = [...pending];
  pending = new Set();

  for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
    try {
      const result = await fetchVipLevels(chunk);
      if (Object.keys(result).length > 0) {
        useUserVipStore.setState((state) => ({
          levels: { ...state.levels, ...result },
        }));
      }
    } catch {
      // 尽力而为：失败就让这些名字先按普通样式显示；从 requested 移除以便下次重试。
      chunk.forEach((id) => requested.delete(id));
    }
  }
}

/** 请求某个 userId 的 vipLevel（已知 / 在途则跳过）；合并防抖后批量拉取。 */
export function requestVipLevel(userId: string): void {
  if (!userId) {
    return;
  }
  if (userId in useUserVipStore.getState().levels || requested.has(userId)) {
    return;
  }
  requested.add(userId);
  pending.add(userId);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flush();
    }, BATCH_DELAY_MS);
  }
}

/**
 * 读取某用户的 vipLevel（会员名字特效用）。未知时返回 undefined 并触发一次批量拉取，
 * 数据回来后自动重渲染。userId 为空则不查。
 */
export function useUserVipLevel(userId?: string | null): number | undefined {
  const level = useUserVipStore((state) =>
    userId ? state.levels[userId] : undefined,
  );
  useEffect(() => {
    if (userId) {
      requestVipLevel(userId);
    }
  }, [userId]);
  return level;
}
