/**
 * authPersist.ts — authStore 的 zustand persist 版本 / 迁移逻辑
 *
 * 单独成文件的原因：迁移逻辑不依赖任何原生模块（MMKV / RN），可被
 * node:test 直接单测，而 authStore 因为 import 了 @/storage（MMKV）无法在
 * node 环境加载。
 *
 * 背景（为什么需要 migrate）：
 *   v0 时代持久化配置没有显式 version，zustand 默认按 version 0 落盘
 *   （AsyncStorage → 后来原样迁入 MMKV）。c6ed569 把 version 提到 1 却没有
 *   提供 migrate，于是 zustand 发现 0 !== 1 且无 migrate 时会
 *   `console.error("State loaded from storage couldn't be migrated ...")`
 *   并直接丢弃整份持久化数据 —— 已登录用户升级后被静默登出。
 *
 *   v0 与 v1 的持久化字段形状完全一致（见 authStore 的 partialize），所以这里
 *   做的是「原样向前迁移」：保留 token / user，让会话平滑跨过版本号。
 */
import type { AuthUser } from './authStore';

/** persist 实际落盘的字段子集（必须与 authStore 的 partialize 保持一致） */
export interface PersistedAuthState {
  accessToken: string | null;
  refreshToken: string | null;
  imToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
}

/** 当前持久化数据的版本号。改这个值时务必同步更新 migrateAuthPersist。 */
export const AUTH_PERSIST_VERSION = 1;

/**
 * 把任意历史版本的持久化数据迁移到当前版本。
 *
 * 现存所有历史版本（v0 = 升级前无显式 version，v1 = 当前）的字段形状一致，
 * 因此原样保留持久化字段；token 是否合法由 authStore 的 onRehydrateStorage
 * 兜底校验（非空字符串），这里不重复判断。
 *
 * 对于损坏 / 非对象输入返回空对象，交给 store 默认值 + onRehydrateStorage 处理，
 * 避免把非对象 spread 进 state 造成脏数据。
 */
export function migrateAuthPersist(
  persistedState: unknown,
  _version: number,
): Partial<PersistedAuthState> {
  if (typeof persistedState !== 'object' || persistedState === null) {
    return {};
  }
  return persistedState as Partial<PersistedAuthState>;
}
