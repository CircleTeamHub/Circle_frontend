import { create } from 'zustand';
import {
  isMessageDeletedLocally,
  markMessageDeletedLocally,
} from './deleted-messages';
import type { ChatConversationDto, ChatMessageDto } from './protocol';
import {
  clearLocalConversationMessages,
  deleteLocalMessage,
  outboxDelete,
  persistLocalConversations,
  persistLocalMessages,
  removeLocalConversation,
  upsertLocalConversation,
} from './local-db';

/**
 * 每会话的初始内存窗口。翻页会把窗口按页扩大 —— 固定 200 的话,已经有 200 条
 * 新消息之后再拉一页更早的历史,合并后排序把这页排在窗口之前,截断当场把它全部
 * 丢掉;而翻页游标照常前进,于是「越滚越请求、永远看不到第 201 条以前」。
 */
export const MESSAGES_CAP = 200;
/** 窗口扩张的硬上限,防止一路翻到底把整个会话读进内存。 */
export const MESSAGES_WINDOW_MAX = 2000;
/** 对端 typing 显示时长:超过它没有新 typing 事件就回落在线状态。 */
export const TYPING_DISPLAY_MS = 4_000;

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
  /**
   * 全量会话快照的序号,每成功拉取一次 +1。
   *
   * 「会话又出现在列表里」不能直接当作重新入群的证据 —— 那份快照可能是在
   * 移除事件**之前**发出的。带上序号就能区分:只有移除之后**新拉回来的**
   * 快照里还有这个会话,才说明真的又在座了。
   */
  conversationsSnapshotSeq: number;
  /** 单会话回写(偏好变更/新建后),保持排序不变量。 */
  upsertConversation: (conversation: ChatConversationDto) => void;
  /** G-01 冷启动水合:本地库快照灌回内存(仅在对应结构为空时生效)。 */
  hydrateLocalSnapshot: (
    conversations: ChatConversationDto[],
    messagesByConversation: Record<string, ChatMessageDto[]>,
  ) => void;
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
  /**
   * 只从内存窗口里驱逐一段旧消息,**不写删除墓碑**。
   * 冷缓存缺口过大时的作废路径用 —— 走 removeMessage 会把这些完全正常的
   * 服务端消息永久标成「用户删过」,此后翻页和搜索里再也见不到。
   */
  evictMessagesBelow: (conversationId: string, height: number) => void;
  /**
   * 丢掉全部缓存消息(会话行保留)。
   * 服务端说增量游标超出保留窗口时用 —— 那段区间的撤回已经查不到了,
   * 缓存里的消息会永远显示原文,只能整体作废重新拉。
   */
  dropCachedMessages: () => void;
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
  /** 对端「正在输入」有效期(conversationId → epoch ms;过期即不显示)。 */
  typingUntilByConversation: Record<string, number>;
  applyTyping: (conversationId: string) => void;
  /** G-07 送达水位(conversationId → userId → height,只前进)。 */
  deliveredWatermarks: Record<string, Record<string, number>>;
  applyDelivered: (
    conversationId: string,
    userId: string,
    height: number,
  ) => void;
  /** G-07 表情回应落地(广播与本端乐观共用,幂等)。 */
  applyReaction: (
    conversationId: string,
    messageId: string,
    emoji: string,
    userId: string,
    op: 'add' | 'remove',
  ) => void;
  /** G-07 消息编辑落地(content 替换 + editedAt;height 不变)。 */
  applyEdit: (
    conversationId: string,
    messageId: string,
    content: Record<string, unknown>,
    editedAt: string,
  ) => void;
  /** S-01:会话级焚毁档位变更(REST 回执/系统消息驱动)。 */
  applyBurnDuration: (
    conversationId: string,
    burnDurationSec: number | null,
  ) => void;
  /**
   * G-14:清空聊天记录的本地落地(时间线/预览/未读一次清干净)。
   *
   * clearedBeforeHeight:
   * - number  服务端回执里的权威水位;
   * - 省略    离线清空,退而用本地已知最高 height;
   * - null    **不留水位**,只清当前这份缓存。被移出会话的收尾用这个 ——
   *           留了水位的话,以后重新入群时那段历史会被入库口一直挡在外面。
   */
  clearConversationLocal: (
    conversationId: string,
    clearedBeforeHeight?: number | null,
  ) => void;
  /**
   * 每会话的本地清空水位。
   *
   * 只清数组是不够的:清空前发出的历史分页/重连补拉会在清空**之后**才落地,
   * 那条 ingest 会把刚清掉的时间线原样填回来;水位之下的延迟 chat:msg 同理。
   * 记住水位、在唯一入库口按它挡,才是「清空」而不是「清了一下」。
   */
  clearedBeforeHeightByConversation: Record<string, number>;
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

/**
 * 同一条消息的新旧两份快照合并成一份。
 *
 * 按 id 无条件覆盖是不行的:一次历史翻页/重连补拉可能在**撤回或编辑事件之后**
 * 才落地,而它捕获的是事件之前的那一版 —— 于是刚刚撤回的原文当着用户的面
 * 又回到屏幕上,编辑同理会退回旧文本。撤回/编辑只存在于当前这份 DTO 上,
 * 没有版本号可比,所以在这里把「更终局的状态」显式保下来。
 */
function mergeMessageState(
  prior: ChatMessageDto,
  next: ChatMessageDto,
): ChatMessageDto {
  // 撤回是终局:任何不带撤回状态的旧快照都不能把它盖回去。
  if (prior.revokedAt && !next.revokedAt) {
    return {
      ...next,
      content: {},
      revokedAt: prior.revokedAt,
      revokedBy: prior.revokedBy,
    };
  }
  const priorEdited = prior.editedAt ? Date.parse(prior.editedAt) : 0;
  const nextEdited = next.editedAt ? Date.parse(next.editedAt) : 0;
  if (priorEdited > nextEdited) {
    return { ...next, content: prior.content, editedAt: prior.editedAt };
  }
  return next;
}

/**
 * 自己的已读水位推进后,本机未读的收敛值。
 *
 * `latestHeight - readHeight` 会把**自己发的**消息也算成未读:未读 1 条对端
 * 消息(height=1)之后自己又发了两条(2、3),另一台设备读到 1 时这里算出
 * 3-1=2,取 min 之后红点停在 1 而不是清零。服务端口径从来不含自己发的,
 * 所以有本地时间线时就按时间线数「水位之上、非本人发」的条数;时间线不在
 * 内存里(会话没打开过)才回落到上界估算。
 */
function convergeUnread(
  conversations: ChatConversationDto[],
  index: number,
  timeline: ChatMessageDto[],
  readHeight: number,
  currentUserId: string,
): ChatConversationDto[] | undefined {
  const target = conversations[index];
  const latestHeight = target.lastMessage?.height ?? 0;
  const coversTimeline =
    timeline.length > 0 &&
    timeline.some((m) => m.height > 0 && m.height <= readHeight);
  const remaining = coversTimeline
    ? timeline.filter(
        (m) =>
          m.height > readHeight && (m.sender?.id ?? null) !== currentUserId,
      ).length
    : Math.max(0, latestHeight - readHeight);
  const converged = Math.min(target.unreadCount, remaining);
  if (converged === target.unreadCount) return undefined;
  return [
    ...conversations.slice(0, index),
    { ...target, unreadCount: converged },
    ...conversations.slice(index + 1),
  ];
}

/**
 * 服务端会话快照落地前,套上本机已经知道、但快照里还没有的两件事:
 * 本账号的已读水位(可能来自另一台设备)与本机清空水位。
 */
function reconcileWithLocalWatermarks(
  conversation: ChatConversationDto,
  selfReadHeight: number,
  clearedFloor: number,
  timeline: ChatMessageDto[],
  currentUserId: string | null,
): ChatConversationDto {
  let next = conversation;
  if (clearedFloor > 0) {
    const last = next.lastMessage;
    if (last && last.height > 0 && last.height <= clearedFloor) {
      next = { ...next, lastMessage: null, unreadCount: 0 };
    }
  }
  if (selfReadHeight > 0 && currentUserId && next.unreadCount > 0) {
    const converged = convergeUnread(
      [next],
      0,
      timeline,
      selfReadHeight,
      currentUserId,
    );
    if (converged) next = converged[0];
  }
  return next;
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
    const prior = byId.get(message.id);
    byId.set(message.id, prior ? mergeMessageState(prior, message) : message);
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
  conversationsSnapshotSeq: 0,
  messagesByConversation: {},
  messageWindowByConversation: {},
  clearedBeforeHeightByConversation: {},
  activeConversationId: null,
  onlineByUser: {},
  readWatermarks: {},
  deliveredWatermarks: {},
  typingUntilByConversation: {},

  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
  setError: (error) => set({ error }),
  setCurrentUserId: (userId) => set({ currentUserId: userId }),
  setConversations: (conversations) => {
    const {
      messagesByConversation,
      readWatermarks,
      currentUserId,
      clearedBeforeHeightByConversation,
    } = get();
    set({
      conversations: sortConversations(
        conversations
          .map((c) => reconcileDeletedPreview(c, messagesByConversation[c.id]))
          // 快照是请求发出那一刻的事实。这段时间里本账号可能已经在另一台
          // 设备上读过(chat:read 先到、会话还不在 store 里,applyRead 当时
          // 无从收敛),或者本机刚清空过 —— 直接装进来就是红点/预览回退,
          // 而且不保证还会有第二个事件来纠正。
          .map((c) =>
            reconcileWithLocalWatermarks(
              c,
              readWatermarks[c.id]?.[currentUserId ?? ''] ?? 0,
              clearedBeforeHeightByConversation[c.id] ?? 0,
              messagesByConversation[c.id] ?? [],
              currentUserId,
            ),
          ),
      ),
      // 只有全量拉取会走到这里(upsertConversation 不置位)。
      conversationsSnapshotLoaded: true,
      conversationsSnapshotSeq: get().conversationsSnapshotSeq + 1,
    });
    // G-01:快照落盘(fire-and-forget,本地库失败不影响主链路)。
    void persistLocalConversations(get().conversations);
  },
  upsertConversation: (conversation) => {
    const { conversations, messagesByConversation } = get();
    const rest = conversations.filter((c) => c.id !== conversation.id);
    const reconciled = reconcileDeletedPreview(
      conversation,
      messagesByConversation[conversation.id],
    );
    set({ conversations: sortConversations([...rest, reconciled]) });
    void upsertLocalConversation(reconciled);
  },
  removeConversation: (conversationId) => {
    set({
      conversations: get().conversations.filter((c) => c.id !== conversationId),
    });
    void removeLocalConversation(conversationId);
  },

  /**
   * G-01 冷启动水合:把本地库快照灌回内存(不置 conversationsSnapshotLoaded ——
   * 它表示「拿到过服务端全量」,本地快照只是残影,搜索归组等仍需真拉取)。
   * 只在内存还是空的时候生效,避免覆盖已经到手的服务端数据。
   */
  hydrateLocalSnapshot: (conversations, messagesByConversation) => {
    const state = get();
    if (state.conversations.length === 0 && conversations.length > 0) {
      set({ conversations: sortConversations(conversations) });
    }
    const nextTimelines: Record<string, ChatMessageDto[]> = {
      ...state.messagesByConversation,
    };
    let changed = false;
    for (const [conversationId, timeline] of Object.entries(
      messagesByConversation,
    )) {
      if ((nextTimelines[conversationId] ?? []).length > 0) continue;
      if (timeline.length === 0) continue;
      nextTimelines[conversationId] = timeline;
      changed = true;
    }
    if (changed) set({ messagesByConversation: nextTimelines });
  },
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
    void deleteLocalMessage(conversationId, messageId);
    // height=0 的失败气泡根本不在 messages 表里 —— 它只存在于 outbox。
    // 不把 outbox 行一起删掉的话,那条(用户认为已经删除的)私信正文会无限期
    // 留在本地库里,而且等有界的删除墓碑被淘汰之后还会在冷启动时重新冒出来。
    const failedTarget = (get().messagesByConversation[conversationId] ?? []).find(
      (m) => m.id === messageId && m.height === 0 && m.d,
    );
    if (failedTarget?.d) void outboxDelete(failedTarget.d);
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

  evictMessagesBelow: (conversationId, height) => {
    const { messagesByConversation } = get();
    const existing = messagesByConversation[conversationId];
    if (!existing) return;
    const kept = existing.filter((m) => !(m.height > 0 && m.height < height));
    if (kept.length === existing.length) return;
    set({
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: kept,
      },
    });
  },

  dropCachedMessages: () =>
    set({
      messagesByConversation: {},
      messageWindowByConversation: {},
    }),

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
    // 少挡一条「删除」就会在下一次拉取时复活。清空水位同理 —— 在途的历史
    // 请求会在清空之后落地,不挡就把刚清掉的时间线又填回来。
    const clearedFloor =
      get().clearedBeforeHeightByConversation[conversationId] ?? 0;
    const incoming = rawIncoming.filter(
      (m) =>
        !isMessageDeletedLocally(m.id, m.d) &&
        !(clearedFloor > 0 && m.height > 0 && m.height <= clearedFloor),
    );
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
    // G-01:唯一写入口顺手落盘(广播/回执/历史/补拉都汇到这里)。
    void persistLocalMessages(conversationId, incoming);
  },

  applyTyping: (conversationId) => {
    const { typingUntilByConversation } = get();
    set({
      typingUntilByConversation: {
        ...typingUntilByConversation,
        [conversationId]: Date.now() + TYPING_DISPLAY_MS,
      },
    });
  },

  applyDelivered: (conversationId, userId, height) => {
    const { deliveredWatermarks } = get();
    const conversation = deliveredWatermarks[conversationId] ?? {};
    const prior = conversation[userId] ?? 0;
    if (height <= prior) return;
    set({
      deliveredWatermarks: {
        ...deliveredWatermarks,
        [conversationId]: { ...conversation, [userId]: height },
      },
    });
  },

  applyReaction: (conversationId, messageId, emoji, userId, op) => {
    const { messagesByConversation } = get();
    const timeline = messagesByConversation[conversationId];
    if (!timeline) return;
    let changed = false;
    const next = timeline.map((message) => {
      if (message.id !== messageId) return message;
      const reactions = message.reactions ?? [];
      const entry = reactions.find((r) => r.emoji === emoji);
      if (op === 'add') {
        if (entry?.userIds.includes(userId)) return message;
        changed = true;
        return {
          ...message,
          reactions: entry
            ? reactions.map((r) =>
                r.emoji === emoji
                  ? { ...r, userIds: [...r.userIds, userId] }
                  : r,
              )
            : [...reactions, { emoji, userIds: [userId] }],
        };
      }
      if (!entry?.userIds.includes(userId)) return message;
      changed = true;
      const shrunk = entry.userIds.filter((id) => id !== userId);
      return {
        ...message,
        reactions:
          shrunk.length > 0
            ? reactions.map((r) =>
                r.emoji === emoji ? { ...r, userIds: shrunk } : r,
              )
            : reactions.filter((r) => r.emoji !== emoji),
      };
    });
    if (!changed) return;
    set({
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: next,
      },
    });
    const updated = next.find((m) => m.id === messageId);
    if (updated) void persistLocalMessages(conversationId, [updated]);
  },

  applyEdit: (conversationId, messageId, content, editedAt) => {
    const { messagesByConversation, conversations } = get();
    const timeline = messagesByConversation[conversationId];
    const next = (timeline ?? []).map((message) =>
      message.id === messageId && !message.revokedAt
        ? { ...message, content, editedAt }
        : message,
    );
    const index = conversations.findIndex((c) => c.id === conversationId);
    const target = index >= 0 ? conversations[index] : null;
    const previewNeedsUpdate = target?.lastMessage?.id === messageId;
    set({
      ...(timeline
        ? {
            messagesByConversation: {
              ...messagesByConversation,
              [conversationId]: next,
            },
          }
        : {}),
      ...(previewNeedsUpdate && target
        ? {
            conversations: [
              ...conversations.slice(0, index),
              {
                ...target,
                lastMessage: { ...target.lastMessage!, content, editedAt },
              },
              ...conversations.slice(index + 1),
            ],
          }
        : {}),
    });
    const updated = next.find((m) => m.id === messageId);
    if (updated) void persistLocalMessages(conversationId, [updated]);
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

  clearConversationLocal: (conversationId, clearedBeforeHeight) => {
    void clearLocalConversationMessages(conversationId);
    const {
      conversations,
      messagesByConversation,
      clearedBeforeHeightByConversation,
    } = get();
    // 服务端没回水位时(离线清空)退而用本地已知最高 height:总比 0 强。
    // 显式传 null = 不留水位(见类型上的说明)。
    const localMax =
      clearedBeforeHeight === null
        ? 0
        : (messagesByConversation[conversationId] ?? []).reduce(
            (max, m) => (m.height > max ? m.height : max),
            0,
          );
    const floor = Math.max(
      clearedBeforeHeight ?? 0,
      localMax,
      clearedBeforeHeight === null
        ? 0
        : (clearedBeforeHeightByConversation[conversationId] ?? 0),
    );
    const index = conversations.findIndex((c) => c.id === conversationId);
    const nextConversation =
      index >= 0
        ? {
            ...conversations[index],
            lastMessage: null,
            unreadCount: 0,
          }
        : null;
    set({
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: [],
      },
      clearedBeforeHeightByConversation: {
        ...clearedBeforeHeightByConversation,
        [conversationId]: floor,
      },
      ...(nextConversation
        ? {
            conversations: [
              ...conversations.slice(0, index),
              nextConversation,
              ...conversations.slice(index + 1),
            ],
          }
        : {}),
    });
    // 会话行也要落盘:只删消息行的话,离线重启后水合会把旧预览和旧未读
    // 原样恢复,而时间线明明已经清空了。
    if (nextConversation) void upsertLocalConversation(nextConversation);
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
    const persisted = nextTimeline.filter(
      (m) => m.id === messageId || m.replyTo?.id === messageId,
    );
    if (persisted.length > 0) {
      void persistLocalMessages(conversationId, persisted);
    }
  },

  applyRead: (conversationId, userId, height) => {
    // 水位必须是非负安全整数。只查 typeof 的话,一条畸形的 chat:read 带
    // height=1.5 就能把小数写进 unreadCount(角标 API 拿到小数)并污染水位。
    if (!Number.isSafeInteger(height) || height < 0) return;
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
    if (currentUserId !== null && userId === currentUserId) {
      const index = conversations.findIndex((c) => c.id === conversationId);
      if (index >= 0) {
        patch.conversations = convergeUnread(
          conversations,
          index,
          get().messagesByConversation[conversationId] ?? [],
          height,
          currentUserId,
        );
      }
      // index < 0:会话快照还没到(列表请求在途)。水位已经记下了,
      // setConversations 落地时会拿它再收敛一次 —— 否则那份旧快照带着
      // 正数未读装进来,而不保证还会有第二条 read 事件来纠正。
    }
    set(patch);
  },

  clearCachedChats: () =>
    set({
      conversations: [],
      conversationsSnapshotLoaded: false,
      messagesByConversation: {},
      messageWindowByConversation: {},
      clearedBeforeHeightByConversation: {},
      activeConversationId: null,
      readWatermarks: {},
      deliveredWatermarks: {},
      typingUntilByConversation: {},
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
      clearedBeforeHeightByConversation: {},
      activeConversationId: null,
      onlineByUser: {},
      readWatermarks: {},
      deliveredWatermarks: {},
      typingUntilByConversation: {},
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
