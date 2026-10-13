import type { FriendProfile } from '@/services/api/friends';
import type { ChatConversationDto } from '@/chat-core/protocol';

const NOTE_CARD_PICKER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 群名片选择器里的一项。群名片挂的是「群聊」，不是圈子：圈子群和独立群都算，
 * 但只列我当群主的群（选中即在群设置「笔记管理」里绑定）。
 * id 沿用笔记里群名片已有的口径——圈子群用圈子 id，独立群用会话 id
 * （收藏笔记时后端写入的来源群名片也是这个口径）。
 */
export type NoteCardPickerGroup = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

type CacheEntry<T> = {
  accountId: string;
  value: T[];
  updatedAt: number;
};

let friendsCache: CacheEntry<FriendProfile> | null = null;
let groupsCache: CacheEntry<NoteCardPickerGroup> | null = null;
let friendsInFlight: { accountId: string; promise: Promise<FriendProfile[]> } | null = null;
let groupsInFlight: { accountId: string; promise: Promise<NoteCardPickerGroup[]> } | null = null;

function isFresh<T>(entry: CacheEntry<T> | null, accountId: string | null | undefined) {
  return Boolean(
    entry &&
      accountId &&
      entry.accountId === accountId &&
      Date.now() - entry.updatedAt < NOTE_CARD_PICKER_CACHE_TTL_MS,
  );
}

function groupsFromConversations(conversations: ChatConversationDto[]): NoteCardPickerGroup[] {
  // Lazy for the same reason as the friends API below: keep the chat graph out of
  // the editor's initial module load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { selectGroupConversations } = require('@/features/contacts/utils/group-chat-rows') as typeof import('@/features/contacts/utils/group-chat-rows');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mapChatConversationToUI } = require('@/chat-core/mappers') as typeof import('@/chat-core/mappers');
  const byId = new Map<string, NoteCardPickerGroup>();
  // 群名片就是群设置「笔记管理」里的绑定，而只有群主能绑：只列我当群主的群。
  const ownedGroups = selectGroupConversations(conversations).filter(
    (conversation) => conversation.myRole === 'OWNER',
  );
  for (const conversation of ownedGroups) {
    const id = conversation.circleId ?? conversation.id;
    if (byId.has(id)) continue;
    const row = mapChatConversationToUI(conversation);
    byId.set(id, { id, name: row.name, avatarUrl: row.avatarUrl });
  }
  return [...byId.values()];
}

/** 会话列表是全局 store：消息页已经拉过就直接用，打开选择器不必再等网络。 */
function readGroupsFromChatStore(accountId: string | null | undefined) {
  if (!accountId) return null;
  let useChatStore: typeof import('@/chat-core/store').useChatStore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ useChatStore } = require('@/chat-core/store') as typeof import('@/chat-core/store'));
  } catch {
    // The picker still has its direct API fallback if the store cannot load.
    return null;
  }
  // 只有拿到过服务端全量快照才可信：从资料页「发消息」会先 upsert 单个私聊、
  // 冷启动也会先灌本地残影，数组非空却不完整，拿它当权威会让选择器一个群都没有
  // 还被缓存 5 分钟。全量快照下空列表就是真的没有群，直接返回。
  const { conversations, conversationsSnapshotLoaded } = useChatStore.getState();
  return conversationsSnapshotLoaded ? groupsFromConversations(conversations) : null;
}

function primeGroupsFromChatStore(accountId: string | null | undefined) {
  const groups = readGroupsFromChatStore(accountId);
  if (!groups || !accountId) return groups;
  groupsCache = {
    accountId,
    value: groups,
    updatedAt: Date.now(),
  };
  return groups;
}

export function getCachedNotePickerFriends(accountId: string | null | undefined) {
  return accountId && friendsCache?.accountId === accountId ? friendsCache.value : null;
}

export function getCachedNotePickerGroups(accountId: string | null | undefined) {
  const storeGroups = primeGroupsFromChatStore(accountId);
  if (storeGroups) return storeGroups;
  return accountId && groupsCache?.accountId === accountId ? groupsCache.value : null;
}

export function isNotePickerFriendsFresh(accountId: string | null | undefined) {
  return isFresh(friendsCache, accountId);
}

export function isNotePickerGroupsFresh(accountId: string | null | undefined) {
  return isFresh(groupsCache, accountId);
}

export async function loadNotePickerFriends(accountId: string | null | undefined) {
  const key = accountId ?? 'anonymous';
  if (friendsInFlight?.accountId === key) return friendsInFlight.promise;

  let promise: Promise<FriendProfile[]>;
  promise = Promise.resolve()
    .then(() => {
      // The friends API remains lazy so opening the editor does not load its session graph.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { fetchFriends } = require('@/services/api/friends') as typeof import('@/services/api/friends');
      return fetchFriends();
    })
    .then((friends) => {
      friendsCache = {
        accountId: key,
        value: friends,
        updatedAt: Date.now(),
      };
      return friends;
    })
    .finally(() => {
      if (friendsInFlight?.promise === promise) friendsInFlight = null;
    });

  friendsInFlight = { accountId: key, promise };
  return promise;
}

export async function loadNotePickerGroups(accountId: string | null | undefined) {
  const key = accountId ?? 'anonymous';
  const storeGroups = primeGroupsFromChatStore(accountId);
  if (storeGroups) return storeGroups;
  if (groupsInFlight?.accountId === key) return groupsInFlight.promise;

  let promise: Promise<NoteCardPickerGroup[]>;
  promise = Promise.resolve()
    .then(async () => {
      // The chat API remains lazy for the same reason as the friends API above.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { loadChatConversations } = require('@/chat-core/api') as typeof import('@/chat-core/api');
      return groupsFromConversations(await loadChatConversations());
    })
    .then((groups) => {
      groupsCache = {
        accountId: key,
        value: groups,
        updatedAt: Date.now(),
      };
      return groups;
    })
    .finally(() => {
      if (groupsInFlight?.promise === promise) groupsInFlight = null;
    });

  groupsInFlight = { accountId: key, promise };
  return promise;
}

/** Warm both card pickers after the editor is idle so the first tap is local. */
export async function prefetchNoteCardPickerData(accountId: string | null | undefined) {
  if (!accountId) return;
  primeGroupsFromChatStore(accountId);
  await Promise.allSettled([
    isNotePickerFriendsFresh(accountId)
      ? Promise.resolve()
      : loadNotePickerFriends(accountId),
    isNotePickerGroupsFresh(accountId)
      ? Promise.resolve()
      : loadNotePickerGroups(accountId),
  ]);
}
