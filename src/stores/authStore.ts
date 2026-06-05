/**
 * authStore.ts — 用户认证状态（持久化到 MMKV）
 *
 * 持久化字段：accessToken、refreshToken、imToken、user、isAuthenticated
 * 不持久化字段：isLoading、hasHydrated（运行时状态）
 *
 * hasHydrated：MMKV 同步读取完成后由 onRehydrateStorage 置为 true，
 *   SessionBootstrap 监听此字段决定何时执行会话恢复。
 * isLoading：初始为 true，SessionBootstrap 完成后（成功或失败）置为 false，
 *   app/index.tsx 在 isLoading=false 后才根据 isAuthenticated 决定跳转目标。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
import type { DisplayIcon } from '@/types';
import { migrateAuthPersist, AUTH_PERSIST_VERSION } from './authPersist';

export interface AuthUser {
  id: string;
  accountId: string;
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  avatarFrame: string | null;
  cover: string | null;
  email: string | null;
  phoneNumber: string | null;
  wechat: string | null;
  qq: string | null;
  whatsup: string | null;
  persona: string | null;
  helloWords: string | null;
  birthday: string | null;
  gender: 'male' | 'female' | 'other' | 'unset';
  role: string;
  status: string;
  lastOnline: string | null;
  createdAt: string;
  updatedAt: string;
  city: string | null;
  vipLevel: number;
  creditScore: number;
  fancyNumber: boolean;
  displayIcons: DisplayIcon[];
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  imToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasHydrated: boolean;

  setSession: (
    tokens: {
      accessToken: string;
      refreshToken: string;
      imToken?: string | null;
    },
    user: AuthUser
  ) => void;
  setTokens: (tokens: {
    accessToken: string;
    refreshToken: string;
    imToken?: string | null;
  }) => void;
  setUser: (user: AuthUser) => void;
  clearSession: () => void;
  setLoading: (loading: boolean) => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      imToken: null,
      user: null,
      isAuthenticated: false,
      isLoading: true,
      hasHydrated: false,

      setSession: ({ accessToken, refreshToken, imToken }, user) =>
        set({
          accessToken,
          refreshToken,
          imToken: imToken || null,
          user,
          isAuthenticated: true,
          isLoading: false,
        }),

      setTokens: ({ accessToken, refreshToken, imToken }) =>
        set((state) => ({
          accessToken,
          refreshToken,
          imToken:
            typeof imToken === 'string' && imToken.length > 0
              ? imToken
              : state.imToken,
          isAuthenticated: true,
        })),

      setUser: (user) => set({ user }),

      clearSession: () =>
        set({
          accessToken: null,
          refreshToken: null,
          imToken: null,
          user: null,
          isAuthenticated: false,
          isLoading: false,
        }),

      setLoading: (loading) => set({ isLoading: loading }),

      setHydrated: (hydrated) => set({ hasHydrated: hydrated }),
    }),
    {
      name: 'circle-im-auth',
      version: AUTH_PERSIST_VERSION,
      storage: createJSONStorage(() => mmkvJsonStorage),
      // v0（升级前无显式 version）→ v1 字段形状未变，原样向前迁移，
      // 否则 zustand 会因 version 不匹配且无 migrate 而丢弃整份持久化数据，
      // 导致已登录用户升级后被静默登出（即此前报错的根因）。
      migrate: migrateAuthPersist,
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        imToken: state.imToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // MMKV 同步读取完成，通知 SessionBootstrap 可以开始执行
        state?.setHydrated(true);

        // token 必须是非空字符串；MMKV 写入损坏 / 类型异常时不能带着残缺数据执行 /auth/me
        const hasValidTokens =
          typeof state?.accessToken === 'string' &&
          state.accessToken.length > 0 &&
          typeof state?.refreshToken === 'string' &&
          state.refreshToken.length > 0;
        if (!hasValidTokens) {
          state?.clearSession();
        }
      },
    }
  )
);
