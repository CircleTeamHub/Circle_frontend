/**
 * use-message-groups-store.ts — 用户自定义会话分组（前端 Zustand 状态）
 *
 * 数据持久化：
 *   - 真理源：后端 `/api/v1/conversation-groups`
 *   - 本地缓存：MMKV（key `circle-im-conversation-groups`）—— 启动时先显本地，
 *     后台 `load()` 拉服务端，最终一致。
 *
 * 写操作（create / rename / remove / setMembers）一律乐观更新 + 失败回滚 +
 * 收尾 reconcile（用服务端返回值覆盖临时数据）。失败时打 dev warn，
 * 真实错误用 throw 抛给调用方决定 UI 怎么提示。
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { mmkvJsonStorage } from '@/storage';
import {
  createConversationGroup,
  deleteConversationGroup,
  fetchConversationGroups,
  setConversationGroupMembers,
  updateConversationGroup,
} from '@/services/api/conversation-groups';
import type { CustomConversationGroup } from '@/types';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

interface ConversationGroupsState {
  groups: CustomConversationGroup[];
  loading: boolean;
  lastSyncedAt: number | null;
  error: string | null;

  load: () => Promise<void>;
  create: (input: {
    name: string;
    pinnedToTabs?: boolean;
  }) => Promise<CustomConversationGroup>;
  rename: (id: string, name: string) => Promise<void>;
  setPinnedToTabs: (id: string, pinnedToTabs: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setMembers: (id: string, conversationIDs: string[]) => Promise<void>;
  /** Logout teardown — 清空内存 + 持久化缓存，让下个用户从干净状态起步。 */
  reset: () => void;
}

const initialState: Pick<
  ConversationGroupsState,
  'groups' | 'loading' | 'lastSyncedAt' | 'error'
> = {
  groups: [],
  loading: false,
  lastSyncedAt: null,
  error: null,
};

function devWarn(...args: unknown[]) {
  if (isDev) console.warn(...args);
}

function sortGroups(groups: CustomConversationGroup[]): CustomConversationGroup[] {
  // 与后端排序保持一致：sortOrder asc，createdAt asc 作 tiebreaker。
  return [...groups].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

function upsertGroup(
  groups: CustomConversationGroup[],
  next: CustomConversationGroup,
): CustomConversationGroup[] {
  const idx = groups.findIndex((g) => g.id === next.id);
  if (idx < 0) return sortGroups([...groups, next]);
  const copy = [...groups];
  copy[idx] = next;
  return sortGroups(copy);
}

export const useMessageGroupsStore = create<ConversationGroupsState>()(
  persist(
    (set, get) => ({
      ...initialState,

      load: async () => {
        set({ loading: true, error: null });
        try {
          const groups = await fetchConversationGroups();
          set({
            groups: sortGroups(groups),
            loading: false,
            lastSyncedAt: Date.now(),
            error: null,
          });
        } catch (err) {
          devWarn('[conversation-groups] load failed', err);
          // 用 duck-typing 而非 `instanceof Error` —— 后者在 vm.runInNewContext / 跨 realm
          // 场景下不可靠；任意带 string message 的对象都接受。
          const message =
            err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
              ? (err as { message: string }).message
              : i18n.t('messages.groups.loadFailed', { defaultValue: '加载失败' });
          set({ loading: false, error: message });
        }
      },

      create: async ({ name, pinnedToTabs }) => {
        // 乐观：先用一个临时 id 占位（不入持久化是为了避免重启后看到"鬼" group），
        // 但 zustand persist 是按 state 整存的，没办法不持久化某一项。所以我们等服务端
        // 返回后再 upsert —— 创建路径不做乐观插入，create 是低频操作，等服务端 OK。
        const created = await createConversationGroup({ name, pinnedToTabs });
        set((state) => ({
          groups: upsertGroup(state.groups, created),
          lastSyncedAt: Date.now(),
        }));
        return created;
      },

      rename: async (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) {
          throw new Error(
            i18n.t('messages.groups.nameEmpty', { defaultValue: '分组名称不能为空' }),
          );
        }
        const previous = get().groups;
        const optimistic = previous.map((g) =>
          g.id === id ? { ...g, name: trimmed } : g,
        );
        set({ groups: sortGroups(optimistic) });
        try {
          const updated = await updateConversationGroup(id, { name: trimmed });
          set((state) => ({
            groups: upsertGroup(state.groups, updated),
            lastSyncedAt: Date.now(),
          }));
        } catch (err) {
          devWarn('[conversation-groups] rename failed', err);
          set({ groups: previous });
          throw err;
        }
      },

      setPinnedToTabs: async (id, pinnedToTabs) => {
        const previous = get().groups;
        const optimistic = previous.map((g) =>
          g.id === id ? { ...g, pinnedToTabs } : g,
        );
        set({ groups: sortGroups(optimistic) });
        try {
          const updated = await updateConversationGroup(id, { pinnedToTabs });
          set((state) => ({
            groups: upsertGroup(state.groups, updated),
            lastSyncedAt: Date.now(),
          }));
        } catch (err) {
          devWarn('[conversation-groups] setPinnedToTabs failed', err);
          set({ groups: previous });
          throw err;
        }
      },

      remove: async (id) => {
        const previous = get().groups;
        set({ groups: previous.filter((g) => g.id !== id) });
        try {
          await deleteConversationGroup(id);
          set({ lastSyncedAt: Date.now() });
        } catch (err) {
          devWarn('[conversation-groups] remove failed', err);
          set({ groups: previous });
          throw err;
        }
      },

      setMembers: async (id, conversationIDs) => {
        const previous = get().groups;
        const sortedIDs = [...new Set(conversationIDs)].sort();
        const optimistic = previous.map((g) =>
          g.id === id ? { ...g, conversationIDs: sortedIDs } : g,
        );
        set({ groups: sortGroups(optimistic) });
        try {
          const updated = await setConversationGroupMembers(id, conversationIDs);
          set((state) => ({
            groups: upsertGroup(state.groups, updated),
            lastSyncedAt: Date.now(),
          }));
        } catch (err) {
          devWarn('[conversation-groups] setMembers failed', err);
          set({ groups: previous });
          throw err;
        }
      },

      reset: () => {
        set(initialState);
        // 同时把持久化清理掉（除了内存），避免下一个用户启动时看到上一个用户的分组。
        void (async () => {
          try {
            await mmkvJsonStorage.removeItem('circle-im-conversation-groups');
          } catch (err) {
            devWarn('[conversation-groups] reset: failed to clear MMKV cache', err);
          }
        })();
      },
    }),
    {
      name: 'circle-im-conversation-groups',
      storage: createJSONStorage(() => mmkvJsonStorage),
      version: 1,
      // 只持久化 groups + lastSyncedAt；loading / error 是运行时状态。
      partialize: (state) => ({
        groups: state.groups,
        lastSyncedAt: state.lastSyncedAt,
      }),
    },
  ),
);

/**
 * 工具：给定 conversationID，返回它属于哪些分组。
 * 不是 hook —— 用在 selector 内部或外部纯函数链路里。
 */
export function getGroupsForConversation(
  conversationID: string,
  groups: CustomConversationGroup[],
): CustomConversationGroup[] {
  return groups.filter((g) => g.conversationIDs.includes(conversationID));
}
