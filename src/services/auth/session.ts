import { secureAuthStorage } from '@/storage/secure-auth-storage';
import {
  persistCurrentAuthState,
  useAuthStore,
} from '@/stores/authStore';
import { useFriendActivityUnreadStore } from '@/stores/friendActivityUnreadStore';
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useWalletRealtimeStore } from '@/stores/walletRealtimeStore';
import { resetDiagnosticBreadcrumbs } from '@/utils/client-diagnostics';
import { reportHandledFailure } from '@/observability/report-failure';

type PersistCapableAuthStore = {
  persist?: {
    clearStorage?: () => Promise<void> | void;
  };
};

/**
 * 登出 teardown 钩子。session.ts 不再直接 import IM / 实时通道模块，避免
 * `services/api ↔ realtime ↔ services/api/* ↔ services/api/client` 与
 * `session ↔ im/client ↔ im/listeners ↔ session` 这两组模块循环。
 *
 * IM / 实时通道在自身模块加载时通过 registerLogoutHandler 注册 teardown，
 * 由 SessionBootstrap 在 app 启动时确保两个模块都被求值过。
 */
export interface LogoutContext {
  readonly sessionEpoch: number;
  isCurrent: () => boolean;
}

type LogoutHandler = (context: LogoutContext) => void | Promise<void>;
const logoutHandlers: LogoutHandler[] = [];
let activeClearPromise: Promise<void> | null = null;
let activeClearSessionEpoch: number | null = null;

async function loadMessageGroupsStore() {
  const { useMessageGroupsStore } = await import(
    '@/features/messages/store/use-message-groups-store'
  );
  return useMessageGroupsStore;
}

async function loadCirclesStore() {
  const { useCirclesStore } = await import(
    '@/features/discover/store/use-circles-store'
  );
  return useCirclesStore;
}

// 与上面两个 loader 同理惰性加载:静态 import 这两个会形成
// session.ts → use-discover-store/userVipStore → services/api/* → api/client.ts → session.ts
// 的模块环。api/client.ts 求值时会 registerLogoutHandler,而彼时 session.ts 还没初始化完、
// 它的 logoutHandlers 绑定尚未就绪,可能在冷启动阶段崩。改为登出流程里按需 import 破环。
async function loadDiscoverStore() {
  const { useDiscoverStore } = await import(
    '@/features/discover/store/use-discover-store'
  );
  return useDiscoverStore;
}

async function loadVipLevelsInvalidator() {
  const { invalidateVipLevels } = await import('@/stores/userVipStore');
  return invalidateVipLevels;
}

type PersistedResettableStore = {
  getState: () => { resetForLogout: () => void };
  persist?: {
    clearStorage?: () => Promise<void> | void;
  };
};

/**
 * 账号级持久化 store 的显式清理清单（#97）。
 *
 * 决策规则：引用账号数据（conversationID / 圈子 id）的 store 随账号走，登出必清；
 * 纯设备偏好随设备走，跨账号幸存。当前幸存者及理由：
 * - circle-im-app-settings          —— 语言/主题等设备设置
 * - circle-im-notification-feedback —— 设备级通知反馈
 * - circle-im-circle-notification   —— 只有两个横幅/应用内开关，无账号数据
 * - circle-im-known-accounts        —— 账号切换器本体，语义就是跨会话
 * - circle-im-auth                  —— 由上方 persist.clearStorage 单独处理
 *
 * 新增持久化 store 时必须把它加进这里或上面的幸存名单 —— 让「随账号还是随设备」
 * 成为一次显式决定，而不是默认幸存。
 */
const ACCOUNT_SCOPED_STORE_LOADERS: (() => Promise<PersistedResettableStore>)[] = [
  async () =>
    (await import('@/features/messages/store/use-local-unread-store'))
      .useLocalUnreadStore,
  async () =>
    (await import('@/features/chat/store/use-chat-preferences-store'))
      .useChatPreferencesStore,
  async () =>
    (await import('@/features/discover/store/use-discover-filter-store'))
      .useDiscoverFilterStore,
  async () => {
    const { useCircleShortcutOrderStore } = await import(
      '@/features/discover/store/use-circle-shortcut-order-store'
    );
    // 该 store 已有语义相同的 resetOrder，适配成统一形状而不是改它的公共 API。
    return {
      getState: () => ({
        resetForLogout: () => useCircleShortcutOrderStore.getState().resetOrder(),
      }),
      persist: useCircleShortcutOrderStore.persist,
    };
  },
];

async function clearAccountScopedPersistedStores(
  clearedSessionEpoch: number,
): Promise<void> {
  // 内存重置与磁盘清除必须分开对待（PR #129 review P1）：
  //
  // - 内存 resetForLogout()：若登出的异步过程被一个更新的会话抢占（fire-and-forget
  //   的 401/撤销登出 + 期间重新登录），重置会擦掉新会话的实时 UI 状态 —— 因此
  //   只在会话未变时执行。
  // - 磁盘 clearStorage()：承载的是**刚登出账号**的持久化足迹。跳过它会把上一个
  //   账号的 conversationID / 圈子引用留在共享 MMKV key 上，下次水合（冷启动）就
  //   渗进新会话的 UI。所以无论会话是否被抢占都要清，且要清完清单里**每一个** key
  //   （不能因中途会话变化就 return 掉后面的 store）。新会话若已写过同一个共享 key，
  //   其内存态仍在，persist 会在下次状态变更时把自己的数据重新落盘。
  for (const load of ACCOUNT_SCOPED_STORE_LOADERS) {
    try {
      const store = await load();
      if (useAuthStore.getState().sessionEpoch === clearedSessionEpoch) {
        store.getState().resetForLogout();
      }
      await Promise.resolve(store.persist?.clearStorage?.());
    } catch (err) {
      reportHandledFailure('session', 'accountScopedStoreClear', err);
    }
  }
}

/**
 * 注册登出 teardown 钩子，返回反注册函数。HMR / 测试场景下可避免 handler 累积。
 * 同一个 handler 重复注册时只会保留一份。
 */
export function registerLogoutHandler(handler: LogoutHandler): () => void {
  if (!logoutHandlers.includes(handler)) {
    logoutHandlers.push(handler);
  }
  return () => {
    const idx = logoutHandlers.indexOf(handler);
    if (idx >= 0) logoutHandlers.splice(idx, 1);
  };
}

interface ClearLocalSessionOptions {
  preserveLoading?: boolean;
}

async function performClearLocalSession(
  sessionEpoch: number,
  options: ClearLocalSessionOptions = {},
) {
  // teardown 失败不影响后续状态清理；失败汇总到末尾一次性 warn。
  const handlerFailures: unknown[] = [];
  const context: LogoutContext = {
    sessionEpoch,
    isCurrent: () => useAuthStore.getState().sessionEpoch === sessionEpoch,
  };
  const pendingHandlers: Promise<void>[] = [];

  for (const handler of logoutHandlers) {
    try {
      pendingHandlers.push(
        Promise.resolve(handler(context)).catch((err) => {
          handlerFailures.push(err);
        }),
      );
    } catch (err) {
      handlerFailures.push(err);
    }
  }
  await Promise.all(pendingHandlers);

  const useMessageGroupsStore = await loadMessageGroupsStore();
  const useCirclesStore = await loadCirclesStore();
  const useDiscoverStore = await loadDiscoverStore();
  const invalidateVipLevels = await loadVipLevelsInvalidator();

  // 先清 auth，让订阅 useAuthStore 的组件立刻看到"未登录"，
  // 避免 dependent store 被清空后触发"重新拉取"再被丢弃的请求。
  if (!context.isCurrent()) {
    return;
  }

  useAuthStore.getState().clearSession({
    preserveLoading: options.preserveLoading,
  });
  const clearedSessionEpoch = useAuthStore.getState().sessionEpoch;
  useMessageGroupsStore.getState().reset();
  useCirclesStore.getState().reset();
  useFriendActivityUnreadStore.getState().reset();
  useFriendRemarkStore.getState().reset();
  useTabBadgeStore.getState().reset();
  useWalletRealtimeStore.getState().reset();
  // 发现页 feed 含 plazaMembershipRequired 升级墙标记：不随登出重置的话，切到会员账号
  // 后仍可能停在上一个非会员账号的升级墙，直到手动刷新或重启 app。
  useDiscoverStore.getState().reset();
  // 清 userId→vipLevel 缓存：否则切到 B 账号后，通讯录/会话里 A 账号见过的用户仍带
  // A 会话缓存的会员档位（虽同源，但语义上应随会话重建）。
  invalidateVipLevels();
  // 诊断面包屑是进程级内存缓冲，而切换账号不重启 app。不清的话，上一个账号的
  // circleId / conversationID 会搭下一个账号的错误上报离开设备。
  resetDiagnosticBreadcrumbs();

  // 账号级持久化 store（#97）：内存重置 + 删除 MMKV key，防止上一账号的
  // conversationID / 圈子引用渗进下一个会话的 UI。
  await clearAccountScopedPersistedStores(clearedSessionEpoch);

  let persistCleared = false;
  try {
    const persistenceClear = (useAuthStore as PersistCapableAuthStore)
      .persist?.clearStorage?.();
    if (persistenceClear && typeof persistenceClear.then === 'function') {
      await persistenceClear;
    } else {
      await secureAuthStorage.removeItem('circle-im-auth');
    }
    persistCleared = true;
  } catch (err) {
    reportHandledFailure('session', 'persistClear', err);
  }
  // 兜底：persist 未挂或 clearStorage 抛错时，直接对 SecureStore + legacy MMKV key 显式清理。
  // tokens 留在磁盘比"登出失败"提示风险更高 —— 下次启动会自动重新认证回这个用户。
  if (!persistCleared) {
    try {
      await secureAuthStorage.removeItem('circle-im-auth');
    } catch (err) {
      reportHandledFailure('session', 'secureAuthRemoveFallback', err);
    }
  }

  if (useAuthStore.getState().sessionEpoch !== clearedSessionEpoch) {
    try {
      await persistCurrentAuthState();
    } catch (err) {
      reportHandledFailure('session', 'persistNewerSession', err);
    }
  }

  for (const failure of handlerFailures) {
    reportHandledFailure('session', 'logoutHandler', failure);
  }
}

export function clearLocalSession(
  expectedSessionEpoch?: number,
  options: ClearLocalSessionOptions = {},
): Promise<void> {
  const sessionEpoch =
    expectedSessionEpoch ?? useAuthStore.getState().sessionEpoch;

  if (useAuthStore.getState().sessionEpoch !== sessionEpoch) {
    return Promise.resolve();
  }

  if (activeClearPromise) {
    if (activeClearSessionEpoch === sessionEpoch) {
      return activeClearPromise;
    }
    return activeClearPromise
      .catch(() => undefined)
      .then(() => clearLocalSession(sessionEpoch, options));
  }

  const operation = performClearLocalSession(sessionEpoch, options);
  let trackedOperation: Promise<void>;
  trackedOperation = operation.finally(() => {
    if (activeClearPromise === trackedOperation) {
      activeClearPromise = null;
      activeClearSessionEpoch = null;
    }
  });
  activeClearSessionEpoch = sessionEpoch;
  activeClearPromise = trackedOperation;
  return trackedOperation;
}
