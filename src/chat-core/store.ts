import { create } from 'zustand';
import {
  isMessageDeletedLocally,
  markMessageDeletedLocally,
} from './deleted-messages';
import type { ChatConversationDto, ChatMessageDto } from './protocol';

/**
 * 每会话的初始内存窗口。翻页会把窗口按页扩大 —— 固定 200 的话,已经有 200 条
 * 新消息之后再拉一页更早的历史,合并后排序把这页排在窗口之前,截断当场把它全部
 * 丢掉;而翻页游标照常前进,于是「越滚越请求、永远看不到第 201 条以前」。
 */
export const MESSAGES_CAP = 200;
/** 窗口扩张的硬上限,防止一路翻到底把整个会话读进内存。 */
export const MESSAGES_WINDOW_MAX = 2000;

/**
 * store 里的消息 = 线上 DTO + 客户端本地态:
 * failed 只在乐观消息(height=0)发送失败时置位,永不上行。
 */
export type StoredChatMessage = ChatMessageDto & { failed?: boolean };

interface ChatStoreState {
  connected: boolean;
  connecting: boolean;
  /** 最近一次连接失败的原因文案(消息页空态提示用)。 */
  error: string | null;
  currentUserId: string | null;
  conversations: ChatConversationDto[];
  messagesByConversation: Record<string, ChatMessageDto[]>;
  activeConversationId: string | null;
  /** 在线状态表(chat:presence 查询与广播共同维护)。 */
  onlineByUser: Record<string, boolean>;

  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentUserId: (userId: string | null) => void;
  setConversations: (conversations: ChatConversationDto[]) => void;
  /**
   * 是否已经拿到过**完整**会话快照(loadChatConversations 成功过一次)。
   *
   * 不能用 `conversations.length > 0` 代替:从联系人/资料页点「发消息」会先走
   * ensureDirectConversation,它只 upsert 那一个会话 —— 数组非空,内容却是残缺的。
   * 全局搜索据此判断「不用拉了」的话,归组时会把所有「本地没有这个会话」的
   * 服务端命中整条丢掉,界面上是彻底的「无结果」。
   * reset / clearCachedChats 会把它复位。
   */
  conversationsSnapshotLoaded: boolean;
  /** 单会话回写(偏好变更/新建后),保持排序不变量。 */
  upsertConversation: (conversation: ChatConversationDto) => void;
  removeConversation: (conversationId: string) => void;
  /**
   * 新消息驱动会话列表:末条预览/时间前移、他人消息未读 +1、重排序。
   * 返回 false 表示该会话不在列表里(调用方应去补拉会话元信息)。
   */
  applyIncomingMessage: (message: ChatMessageDto) => boolean;
  /** 发送失败后把会话预览退回上一条真实消息(乐观写入的回滚)。 */
  revertConversationPreview: (conversationId: string) => void;
  /** 本端已读的乐观归零(socket 上报之外的即时 UI 反馈)。 */
  markConversationReadLocal: (conversationId: string) => void;
  /** 乐观消息发送失败:按 d 标记,气泡转失败态。 */
  markMessageFailed: (conversationId: string, d: string) => void;
  /** 本地删除一条消息(仅本端视图;服务端删除随后续批次)。 */
  removeMessage: (conversationId: string, messageId: string) => void;
  setActiveConversationId: (conversationId: string | null) => void;
  applyPresence: (userId: string, online: boolean) => void;
  /**
   * 消息入库（历史页 / 广播 / 本地乐观消息共用）：
   * 按 d 对账替换乐观消息 → 按 id 去重 → height 升序（乐观消息 height=0 按
   * createdAt 排尾）→ 截断到 MESSAGES_CAP（保最新）。
   * 未涉及的会话保持原数组引用（聊天页依赖引用稳定避免全量重渲染）。
   */
  ingestMessages: (conversationId: string, incoming: ChatMessageDto[]) => void;
  /** 每会话当前的内存窗口大小(翻页时扩张)。 */
  messageWindowByConversation: Record<string, number>;
  /** 成员已读推进（服务端广播）；对端已读用于单聊「已读」标记。 */
  applyRead: (conversationId: string, userId: string, height: number) => void;
  /**
   * G-02 撤回落地:时间线消息清 content 标 revoked、列表预览跟随、
   * 同会话内引用它的消息把 replyTo 翻成已撤回。发起端与广播共用(幂等)。
   */
  applyRevoke: (
    conversationId: string,
    messageId: string,
    revokedBy: string,
  ) => void;
  /** S-01:会话级焚毁档位变更(REST 回执/系统消息驱动)。 */
  applyBurnDuration: (
    conversationId: string,
    burnDurationSec: number | null,
  ) => void;
  /** G-14:清空聊天记录的本地落地(时间线/预览/未读一次清干净)。 */
  clearConversationLocal: (conversationId: string) => void;
  readWatermarks: Record<string, Record<string, number>>;
  reset: () => void;
  /**
   * 只清缓存(会话/消息/未读/已读水位),保留连接与身份。
   * 「清空聊天记录」用它而不是 reset:socket 还连着的时候 reset 会把
   * currentUserId 清掉并标记 disconnected,而 connectChat 对已连接的 socket
   * 直接 return —— 之后所有收到的消息(含自己发的)都判不出收发方向,
   * 未读也算错,要真的重连或重启才恢复。
   */
  clearCachedChats: () => void;
}

function sortKey(message: ChatMessageDto): number {
  // height=0 的本地乐观消息永远排在已确认消息之后，内部按发送时间稳定排序。
  if (message.height > 0) return message.height;
  return Number.MAX_SAFE_INTEGER / 2 + Date.parse(message.createdAt);
}

export function mergeMessages(
  existing: ChatMessageDto[],
  incoming: ChatMessageDto[],
  cap: number = MESSAGES_CAP,
): ChatMessageDto[] {
  const byId = new Map<string, ChatMessageDto>();
  const byDelivery = new Map<string, string>();
  for (const message of existing) {
    byId.set(message.id, message);
    if (message.d) byDelivery.set(message.d, message.id);
  }
  for (const message of incoming) {
    // 服务端回执/广播带同一 d：替换掉本地乐观占位（id 不同但 d 相同）。
    if (message.d) {
      const priorId = byDelivery.get(message.d);
      if (priorId !== undefined && priorId !== message.id) {
        byId.delete(priorId);
      }
      byDelivery.set(message.d, message.id);
    }
    byId.set(message.id, message);
  }
  const merged = [...byId.values()].sort((a, b) => sortKey(a) - sortKey(b));
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

/**
 * 会话预览与本地墓碑对账。服务端不知道本端删过什么,REST 快照里的 lastMessage
 * 完全可能正是刚删掉的那条 —— 不换掉的话下拉刷新一次,删掉的内容又回到消息列表上。
 * 退回本地时间线里还留着的最新一条;时间线里也没有(窗口外/刚清过缓存)就只留
 * lastMessageAt,预览留空 —— 排序与时间不受影响,只是不再展示已删内容。
 */
function reconcileDeletedPreview(
  conversation: ChatConversationDto,
  timeline: ChatMessageDto[] | undefined,
): ChatConversationDto {
  const last = conversation.lastMessage;
  if (!last || !isMessageDeletedLocally(last.id, last.d)) return conversation;
  let fallback: ChatMessageDto | null = null;
  for (const message of timeline ?? []) {
    if (message.height > 0 && !isMessageDeletedLocally(message.id, message.d)) {
      fallback = message;
    }
  }
  return { ...conversation, lastMessage: fallback };
}

/** 会话排序不变量:置顶在前 → lastMessageAt 降序 → id 兜底稳定。 */
export function sortConversations(
  conversations: ChatConversationDto[],
): ChatConversationDto[] {
  return [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    if (ta !== tb) return tb - ta;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  connected: false,
  connecting: false,
  error: null,
  currentUserId: null,
  conversations: [],
  conversationsSnapshotLoaded: false,
  messagesByConversation: {},
  messageWindowByConversation: {},
  activeConversationId: null,
  onlineByUser: {},
  readWatermarks: {},

  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
  setError: (error) => set({ error }),
  setCurrentUserId: (userId) => set({ currentUserId: userId }),
  setConversations: (conversations) => {
    const { messagesByConversation } = get();
    set({
      conversations: sortConversations(
        conversations.map((c) =>
          reconcileDeletedPreview(c, messagesByConversation[c.id]),
        ),
      ),
      // 只有全量拉取会走到这里(upsertConversation 不置位)。
      conversationsSnapshotLoaded: true,
    });
  },
  upsertConversation: (conversation) => {
    const { conversations, messagesByConversation } = get();
    const rest = conversations.filter((c) => c.id !== conversation.id);
    const reconciled = reconcileDeletedPreview(
      conversation,
      messagesByConversation[conversation.id],
    );
    set({ conversations: sortConversations([...rest, reconciled]) });
  },
  removeConversation: (conversationId) =>
    set({
      conversations: get().conversations.filter((c) => c.id !== conversationId),
    }),
  applyIncomingMessage: (message) => {
    const {
      conversations,
      currentUserId,
      activeConversationId,
      messagesByConversation,
    } = get();
    const index = conversations.findIndex((c) => c.id === message.conversationId);
    // 列表里没有这个会话(例如对方刚建的单聊):调用方据此去补拉元信息,
    // 否则消息进了时间线但会话行与角标一直不出现,要手动刷新才看得到。
    if (index < 0) return false;
    // 本地已删的消息被重投时既不该回到预览、也不该再算一次未读。
    if (isMessageDeletedLocally(message.id, message.d)) return true;
    const target = conversations[index];
    const fromSelf =
      currentUserId !== null && message.sender?.id === currentUserId;
    // 幂等:同一条消息重复投递不再累计未读。时间线本来就按 id 去重,
    // 不挡这里的话角标会被灌大,而列表里根本找不到对应的新消息。
    const alreadyIngested = (
      messagesByConversation[message.conversationId] ?? []
    ).some((m) => m.id === message.id);
    // 正在看的会话不累计未读(进入会话即视为已读,读水位由屏幕上报)。
    const countsUnread =
      !alreadyIngested &&
      !fromSelf &&
      activeConversationId !== message.conversationId;
    // 单调:预览只随更高的 height 前进。迟到的旧消息不该把会话拉回去、
    // 把预览和时间显示成过期的那一条。乐观消息 height=0,恒可覆盖。
    const isNewerPreview =
      message.height === 0 ||
      target.lastMessage == null ||
      message.height >= target.lastMessage.height;
    const next: ChatConversationDto = {
      ...target,
      lastMessage: isNewerPreview ? message : target.lastMessage,
      lastMessageAt: isNewerPreview ? message.createdAt : target.lastMessageAt,
      unreadCount: countsUnread ? target.unreadCount + 1 : target.unreadCount,
    };
    set({
      conversations: sortConversations([
        ...conversations.slice(0, index),
        next,
        ...conversations.slice(index + 1),
      ]),
    });
    return true;
  },

  revertConversationPreview: (conversationId) => {
    const { conversations, messagesByConversation } = get();
    const index = conversations.findIndex((c) => c.id === conversationId);
    if (index < 0) return;
    // 时间线里最后一条「非失败、非乐观」的消息才是权威预览。
    const timeline = messagesByConversation[conversationId] ?? [];
    let authoritative: ChatMessageDto | null = null;
    for (const message of timeline) {
      if (message.height > 0 && !(message as StoredChatMessage).failed) {
        authoritative = message;
      }
    }
    const target = conversations[index];
    if (target.lastMessage?.id === authoritative?.id) return;
    const next: ChatConversationDto = {
      ...target,
      lastMessage: authoritative,
      lastMessageAt: authoritative?.createdAt ?? target.lastMessageAt,
    };
    set({
      conversations: sortConversations([
        ...conversations.slice(0, index),
        next,
        ...conversations.slice(index + 1),
      ]),
    });
  },
  markMessageFailed: (conversationId, d) => {
    const { messagesByConversation } = get();
    const existing = messagesByConversation[conversationId] ?? [];
    const index = existing.findIndex(
      (m) => m.d === d && m.height === 0 && !(m as StoredChatMessage).failed,
    );
    if (index < 0) return;
    const next: StoredChatMessage = { ...existing[index], failed: true };
    set({
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: [
          ...existing.slice(0, index),
          next,
          ...existing.slice(index + 1),
        ],
      },
    });
  },

  removeMessage: (conversationId, messageId) => {
    // 墓碑先落盘,再动内存:只改数组的话下次拉历史就把它接回来了。
    // 连 d 一起记:删的若是还没拿到 ack 的气泡,手上只有 local:<d> 这个临时 id,
    // 而确认/回声回来时带的是全新的服务端 id —— 只按 id 记的话,
    // 删除会在慢网下当着用户的面自己撤销。
    const { messagesByConversation } = get();
    const existing = messagesByConversation[conversationId] ?? [];
    const target = existing.find((m) => m.id === messageId);
    markMessageDeletedLocally(messageId, target?.d ?? null);
    const filtered = existing.filter((m) => m.id !== messageId);
    if (filtered.length !== existing.length) {
      set({
        messagesByConversation: {
          ...messagesByConversation,
          [conversationId]: filtered,
        },
      });
    }
    // 删的正好是会话预览那条:预览得跟着退回时间线里还留着的最新一条,
    // 否则消息页继续把已经删掉的内容当最新消息展示。
    const conversation = get().conversations.find((c) => c.id === conversationId);
    if (conversation?.lastMessage?.id === messageId) {
      get().revertConversationPreview(conversationId);
    }
  },

  markConversationReadLocal: (conversationId) => {
    const { conversations } = get();
    const index = conversations.findIndex((c) => c.id === conversationId);
    if (index < 0 || conversations[index].unreadCount === 0) return;
    const next = { ...conversations[index], unreadCount: 0 };
    set({
      conversations: [
        ...conversations.slice(0, index),
        next,
        ...conversations.slice(index + 1),
      ],
    });
  },
  setActiveConversationId: (conversationId) =>
    set({ activeConversationId: conversationId }),
  applyPresence: (userId, online) => {
    const { onlineByUser } = get();
    if (onlineByUser[userId] === online) return;
    set({ onlineByUser: { ...onlineByUser, [userId]: online } });
  },

  ingestMessages: (conversationId, rawIncoming) => {
    // 本地删过的消息在这里一次性挡掉:历史页、翻页、广播、补拉都走这条路,
    // 少挡一条「删除」就会在下一次拉取时复活。
    const incoming = rawIncoming.filter((m) => !isMessageDeletedLocally(m.id, m.d));
    if (incoming.length === 0) return;
    const { messagesByConversation, messageWindowByConversation } = get();
    const existing = messagesByConversation[conversationId] ?? [];
    const currentCap = messageWindowByConversation[conversationId] ?? MESSAGES_CAP;
    // 这批是不是「更早的一页」:全部低于当前窗口里最旧的那条 height。
    // 是的话把窗口按这页的量扩大,否则截断会把刚拉回来的历史当场丢掉。
    const oldestHeight = existing.find((m) => m.height > 0)?.height ?? 0;
    const isOlderPage =
      oldestHeight > 0 &&
      incoming.length > 0 &&
      incoming.every((m) => m.height > 0 && m.height < oldestHeight);
    const nextCap = isOlderPage
      ? Math.min(currentCap + incoming.length, MESSAGES_WINDOW_MAX)
      : currentCap;
    const merged = mergeMessages(existing, incoming, nextCap);
    set({
      // 只替换本会话的键：其它会话数组引用保持不变（引用稳定契约）。
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: merged,
      },
      ...(nextCap !== currentCap
        ? {
            messageWindowByConversation: {
              ...messageWindowByConversation,
              [conversationId]: nextCap,
            },
          }
        : {}),
    });
  },

  applyBurnDuration: (conversationId, burnDurationSec) => {
    const { conversations } = get();
    const index = conversations.findIndex((c) => c.id === conversationId);
    if (index < 0) return;
    if ((conversations[index].burnDurationSec ?? null) === burnDurationSec) {
      return;
    }
    set({
      conversations: [
        ...conversations.slice(0, index),
        { ...conversations[index], burnDurationSec },
        ...conversations.slice(index + 1),
      ],
    });
  },

  clearConversationLocal: (conversationId) => {
    const { conversations, messagesByConversation } = get();
    const index = conversations.findIndex((c) => c.id === conversationId);
    set({
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: [],
      },
      ...(index >= 0
        ? {
            conversations: [
              ...conversations.slice(0, index),
              {
                ...conversations[index],
                lastMessage: null,
                unreadCount: 0,
              },
              ...conversations.slice(index + 1),
            ],
          }
        : {}),
    });
  },

  applyRevoke: (conversationId, messageId, revokedBy) => {
    const { messagesByConversation, conversations } = get();
    const timeline = messagesByConversation[conversationId];
    const revokedAt = new Date().toISOString();
    let timelineChanged = false;
    const nextTimeline = (timeline ?? []).map((message) => {
      if (message.id === messageId) {
        if (message.revokedAt) return message; // 幂等:广播+本端乐观各来一次
        timelineChanged = true;
        return { ...message, content: {}, revokedAt, revokedBy };
      }
      if (message.replyTo?.id === messageId && !message.replyTo.revoked) {
        timelineChanged = true;
        return {
          ...message,
          replyTo: { ...message.replyTo, revoked: true, preview: '' },
        };
      }
      return message;
    });
    const index = conversations.findIndex((c) => c.id === conversationId);
    const target = index >= 0 ? conversations[index] : null;
    const previewNeedsUpdate =
      target?.lastMessage?.id === messageId && !target.lastMessage.revokedAt;
    if (!timelineChanged && !previewNeedsUpdate) return;
    set({
      ...(timelineChanged
        ? {
            messagesByConversation: {
              ...messagesByConversation,
              [conversationId]: nextTimeline,
            },
          }
        : {}),
      ...(previewNeedsUpdate && target
        ? {
            conversations: [
              ...conversations.slice(0, index),
              {
                ...target,
                lastMessage: {
                  ...target.lastMessage!,
                  content: {},
                  revokedAt,
                  revokedBy,
                },
              },
              ...conversations.slice(index + 1),
            ],
          }
        : {}),
    });
  },

  applyRead: (conversationId, userId, height) => {
    const { readWatermarks, conversations, currentUserId } = get();
    const conversation = readWatermarks[conversationId] ?? {};
    const prior = conversation[userId] ?? 0;
    if (height <= prior) return;
    const patch: Partial<ChatStoreState> = {
      readWatermarks: {
        ...readWatermarks,
        [conversationId]: { ...conversation, [userId]: height },
      },
    };
    // G-15 多端同步:自己的水位从另一台设备推进时,本机未读一并收敛。
    // height 在会话内连续,latest - read 即未读上界;min 保证只收敛不增长
    // (服务端口径不含自己发的消息,直接取差值可能偏大)。
    if (currentUserId !== null && userId === currentUserId) {
      const index = conversations.findIndex((c) => c.id === conversationId);
      if (index >= 0) {
        const target = conversations[index];
        const latestHeight = target.lastMessage?.height ?? 0;
        const converged = Math.min(
          target.unreadCount,
          Math.max(0, latestHeight - height),
        );
        if (converged !== target.unreadCount) {
          patch.conversations = [
            ...conversations.slice(0, index),
            { ...target, unreadCount: converged },
            ...conversations.slice(index + 1),
          ];
        }
      }
    }
    set(patch);
  },

  clearCachedChats: () =>
    set({
      conversations: [],
  conversationsSnapshotLoaded: false,
      messagesByConversation: {},
      messageWindowByConversation: {},
      activeConversationId: null,
      readWatermarks: {},
    }),

  reset: () =>
    set({
      connected: false,
      connecting: false,
      error: null,
      currentUserId: null,
      conversations: [],
  conversationsSnapshotLoaded: false,
      messagesByConversation: {},
      messageWindowByConversation: {},
      activeConversationId: null,
      onlineByUser: {},
      readWatermarks: {},
    }),
}));

/** 消息 tab 角标 = 非免打扰会话的未读合计(免打扰只显红点由 UI 层处理)。 */
export function selectTotalUnread(state: {
  conversations: ChatConversationDto[];
}): number {
  return state.conversations.reduce(
    (sum, c) => (c.muted ? sum : sum + c.unreadCount),
    0,
  );
}
