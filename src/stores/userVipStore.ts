import { useEffect } from 'react';
import { create } from 'zustand';
import { fetchVipLevels } from '@/services/api/users';

/**
 * userId → vipLevel 的客户端缓存（会员名字特效用）。
 *
 * 内联优先：能随用户/作者/资料返回 vipLevel 的地方（广场 / 朋友圈 / 资料）直接传 prop，
 * 不进本缓存。只有拿不到 vipLevel、只有 userId 的场景（聊天发送者 / 会话列表 / 通讯录 /
 * 通知等 IM/列表）才按 userId 请求：本 store 合并去重、防抖后一次批量拉取
 * `POST /user/vip-levels`，回来后订阅的组件自动重渲染、名字亮起。
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
// 缓存新鲜期：过期后同一 userId 允许再次拉取。否则一个被客服升级的用户会一直停在
// 旧档名字特效、直到 app 冷启动（评审 P2）。5 分钟够久到不刷屏、又够短到升级可感知。
const CACHE_TTL_MS = 5 * 60 * 1000;

// 正在请求中的 id——避免同一批重复请求；成功回来后移出，交由 TTL 决定是否再拉。
const requested = new Set<string>();
// userId → 上次成功拉取的时间戳，用于 TTL 判新鲜。
const fetchedAt = new Map<string, number>();
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function isVipLevelFresh(userId: string): boolean {
  const at = fetchedAt.get(userId);
  return at !== undefined && Date.now() - at < CACHE_TTL_MS;
}

async function flush(): Promise<void> {
  flushTimer = null;
  const ids = [...pending];
  pending = new Set();

  for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
    try {
      const result = await fetchVipLevels(chunk);
      const now = Date.now();
      // 记录拉取时间（含未返回档位=非会员的 id），TTL 内不再重复请求；并移出 requested，
      // 让 TTL 过期后能重新入队、拉到升级后的档位。
      chunk.forEach((id) => {
        requested.delete(id);
        fetchedAt.set(id, now);
      });
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
  // 命中且仍新鲜、或正在请求中，跳过；TTL 过期后允许重新拉取升级后的档位。
  if (isVipLevelFresh(userId) || requested.has(userId)) {
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
 * 显式失效缓存（会员/会话数据刷新、回前台重连等重大事件后可调），强制下次按 userId
 * 重新拉取。TTL 是兜底，此函数用于「已知发生变更」时立即重建，无需等 TTL 过期。
 */
export function invalidateVipLevels(): void {
  requested.clear();
  fetchedAt.clear();
  useUserVipStore.setState({ levels: {} });
}

/**
 * 读取某用户的 vipLevel（会员名字特效用）。未知时返回 undefined 并触发一次批量拉取，
 * 数据回来后自动重渲染。userId 为空则不查（内联已提供 vipLevel 的调用处传 null 即可跳过）。
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
