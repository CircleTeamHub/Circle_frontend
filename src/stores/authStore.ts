/**
 * authStore.ts — 用户认证状态（token 持久化到系统 SecureStore）
 *
 * 持久化字段：accessToken、refreshToken、imToken、user、isAuthenticated
 *   - token 由 secureAuthStorage 拆分写入 SecureStore
 *   - user/isAuthenticated 作为非敏感 metadata 留在 MMKV，避免 SecureStore 大 payload 失败
 * 不持久化字段：isLoading、hasHydrated（运行时状态）
 *
 * hasHydrated：SecureStore 持久化读取完成后由 onRehydrateStorage 置为 true，
 *   SessionBootstrap 监听此字段决定何时执行会话恢复。
 * isLoading：初始为 true，SessionBootstrap 完成后（成功或失败）置为 false，
 *   app/index.tsx 在 isLoading=false 后才根据 isAuthenticated 决定跳转目标。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureAuthStorage } from '@/storage/secure-auth-storage';
import type { DisplayIcon } from '@/types';
import { migrateAuthPersist, AUTH_PERSIST_VERSION } from './authPersist';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

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
  likeCount?: number;
  recognitionCount?: number;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  imToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  onboardingRequired: boolean;
  isLoading: boolean;
  hasHydrated: boolean;

  setSession: (
    tokens: {
      accessToken: string;
      refreshToken: string;
      imToken?: string | null;
    },
    user: AuthUser,
    options?: { onboardingRequired?: boolean }
  ) => void;
  setTokens: (tokens: {
    accessToken: string;
    refreshToken: string;
    imToken?: string | null;
  }) => void;
  setUser: (user: AuthUser) => void;
  setOnboardingRequired: (required: boolean) => void;
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
      onboardingRequired: false,
      isLoading: true,
      hasHydrated: false,

      setSession: ({ accessToken, refreshToken, imToken }, user, options) =>
        set({
          accessToken,
          refreshToken,
          imToken: imToken || null,
          user,
          isAuthenticated: true,
          onboardingRequired: options?.onboardingRequired ?? false,
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

      setOnboardingRequired: (required) =>
        set({ onboardingRequired: required }),

      clearSession: () =>
        set({
          accessToken: null,
          refreshToken: null,
          imToken: null,
          user: null,
          isAuthenticated: false,
          onboardingRequired: false,
          isLoading: false,
        }),

      setLoading: (loading) => set({ isLoading: loading }),

      setHydrated: (hydrated) => set({ hasHydrated: hydrated }),
    }),
    {
      name: 'circle-im-auth',
      version: AUTH_PERSIST_VERSION,
      storage: createJSONStorage(() => secureAuthStorage),
      // 关闭"建店即自动水合"：secureAuthStorage 走 SecureStore(Keychain) 异步读，
      // 自动水合的完成时机不可控，会和 RootLayout 迁移后那次显式 rehydrate 抢跑，
      // 造成多次水合（也是此前 onboarding 被弹回的放大器）。改为只由 app/_layout.tsx
      // 迁移完成后显式 rehydrate 一次，水合时机确定、且只发生一次。
      skipHydration: true,
      // v0（升级前无显式 version）→ v1 字段形状未变，原样向前迁移，
      // 否则 zustand 会因 version 不匹配且无 migrate 而丢弃整份持久化数据，
      // 导致已登录用户升级后被静默登出（即此前报错的根因）。
      migrate: migrateAuthPersist,
      // 关键修复（注册被登出 / 完成 onboarding 又被弹回的根因）：
      // zustand 默认 merge 是 {...current, ...persisted}，让磁盘旧值覆盖内存。
      // 但 secureAuthStorage 把 token(SecureStore) 与 metadata(MMKV) 分开异步写，
      // 一次迟到的 rehydrate 可能在"新会话只写了一半"时读到半新半旧的持久化，
      // 再盖回内存——表现为刚 setSession 的会话被旧值覆盖、onboardingRequired 被改回 true。
      // 因此：只要内存里已经是"活跃会话"（已认证 + 有有效 accessToken），就忽略本次
      // merge、保留内存里更新的会话；冷启动尚未登录时照常合并持久化以恢复会话。
      merge: (persistedState, currentState) => {
        const memoryHasLiveSession =
          currentState.isAuthenticated &&
          typeof currentState.accessToken === 'string' &&
          currentState.accessToken.length > 0;
        if (memoryHasLiveSession) {
          return currentState;
        }
        return {
          ...currentState,
          ...(persistedState && typeof persistedState === 'object'
            ? (persistedState as Partial<AuthState>)
            : {}),
        };
      },
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        imToken: state.imToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        onboardingRequired: state.onboardingRequired,
      }),
      onRehydrateStorage: () => (state, error) => {
        const nextState = state ?? useAuthStore.getState();
        // SecureStore 持久化读取完成，通知 SessionBootstrap 可以开始执行
        nextState.setHydrated(true);

        if (error) {
          // 「读」失败属瞬时 / 基础设施问题（锁屏下 Keychain 不可读、冷启动早期抖动）。
          // 关键：绝不能在这里 clearSession —— 它会把空态写回，连带删掉磁盘上完好的 token，
          // 让「一次读抖动 = 永久登出」。这里只解除启动阻塞、保留磁盘凭证，留待下次启动恢复；
          // secureAuthStorage 已进入 degraded 模式，会拦截随后写回的空态、不动磁盘数据。
          if (isDev) {
            console.warn(
              '[authStore] persisted auth hydration read failed; preserving stored credentials',
              error,
            );
          }
          nextState.setLoading(false);
          return;
        }

        // 与 merge 同样的保护：一次迟到的 rehydrate 不能清掉内存里已经存在的活跃会话
        // （刚 setSession 完成登录/注册）。只有当前内存态也没有有效会话时，才是真正的
        // "持久化里没有可用凭证"，可以清。
        const live = useAuthStore.getState();
        const memoryHasLiveSession =
          live.isAuthenticated &&
          typeof live.accessToken === 'string' &&
          live.accessToken.length > 0;
        if (memoryHasLiveSession) {
          return;
        }

        // token 必须是非空字符串；持久化数据损坏 / 类型异常时不能带着残缺数据执行 /auth/me
        const hasValidTokens =
          typeof nextState.accessToken === 'string' &&
          nextState.accessToken.length > 0 &&
          typeof nextState.refreshToken === 'string' &&
          nextState.refreshToken.length > 0;
        if (!hasValidTokens) {
          nextState.clearSession();
        }
      },
    }
  )
);
