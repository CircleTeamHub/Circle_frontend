import { create } from 'zustand';
import { storage } from '@/storage';
import { isBurnDurationChoice } from './burn-durations';
import {
  isMessageDeletedLocally,
  markMessageDeletedLocally,
} from './deleted-messages';
import type { ChatConversationDto, ChatMessageDto } from './protocol';
import {
  clearLocalConversationMessages,
  deleteLocalMessage,
  deleteLocalMessages,
  outboxDelete,
  purgeExpiredLocalMessages,
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
/** Keep self-destruct purges below the browser timer clamp and cover cached rows. */
const BURN_PURGE_SWEEP_MS = 60_000;

/**
 * 缓存键带 `.sec` 后缀:上一版这里存的是**天数**,同名键会让升级后的第一次冷启动
 * 把 `7`(天)读成 7 秒,冷启动那一瞬间几乎所有历史消息都会被判过期清掉。
 * 换个键等于让旧值自然失效,下一次策略 GET 会把真实值补回来。
 */
export function viewerSelfDestructSecStorageKey(userId: string): string {
  return `chat.viewerSelfDestructSec.${userId}`;
}

function normalizeViewerSelfDestructSec(seconds: number): number | null {
  return isBurnDurationChoice(seconds) ? seconds : null;
}

/** Removes expired local previews before a cold-start snapshot reaches the UI. */
export function sanitizeExpiredConversationPreviews(
  conversations: ChatConversationDto[],
  viewerSelfDestructSec: number,
  viewerSelfDestructStartedAt: string | null | number = null,
  now = Date.now(),
): ChatConversationDto[] {
  if (typeof viewerSelfDestructStartedAt === 'number') {
    now = viewerSelfDestructStartedAt;
    viewerSelfDestructStartedAt = null;
  }
  const viewerSeconds = viewerSelfDestructSec > 0 ? viewerSelfDestructSec : null;
  const viewerStart = viewerSelfDestructStartedAt
    ? Date.parse(viewerSelfDestructStartedAt)
    : NaN;
  return conversations.map((conversation) => {
    const conversationSeconds =
      conversation.burnDurationSec && conversation.burnDurationSec > 0
        ? conversation.burnDurationSec
        : null;
    const previewCreatedAt = conversation.lastMessage
      ? Date.parse(conversation.lastMessage.createdAt)
      : NaN;
    const burnStart = conversation.burnStartedAt
      ? Date.parse(conversation.burnStartedAt)
      : NaN;
    const expiresAt = Number.isFinite(previewCreatedAt)
      ? Math.min(
          Number.isFinite(burnStart) && conversationSeconds
            ? previewCreatedAt + conversationSeconds * 1000
            : Infinity,
          Number.isFinite(viewerStart) && viewerSeconds && previewCreatedAt >= viewerStart
            ? previewCreatedAt + viewerSeconds * 1000
            : Infinity,
        )
      : Infinity;
    if (
      !conversation.lastMessage ||
      !Number.isFinite(previewCreatedAt) ||
      expiresAt > now
    ) {
      return conversation;
    }
    return {
      ...conversation,
      lastMessage: null,
      lastMessageAt: null,
      unreadCount: 0,
    };
  });
}

function hasBurnPolicyChanged(
  current: ChatConversationDto[],
  next: ChatConversationDto[],
): boolean {
  const duration = (conversation: ChatConversationDto | undefined): number =>
    conversation?.burnDurationSec && conversation.burnDurationSec > 0
      ? conversation.burnDurationSec
      : 0;
  const startedAt = (conversation: ChatConversationDto | undefined): string | null =>
    conversation?.burnStartedAt ?? null;
  const nextById = new Map(next.map((conversation) => [conversation.id, conversation]));
  for (const conversation of current) {
    const incoming = nextById.get(conversation.id);
    if (
      duration(conversation) !== duration(incoming) ||
      startedAt(conversation) !== startedAt(incoming)
    ) {
      return true;
    }
  }
  const currentIds = new Set(current.map((conversation) => conversation.id));
  return next.some(
    (conversation) =>
      !currentIds.has(conversation.id) && duration(conversation) > 0,
  );
}

/**
 * 用会话快照里的对端已读水位初始化本地回执状态。
 *
 * 实时 chat:read 只在水位推进时广播；如果对端在本机连接前已经读过，
 * 本机永远收不到那次事件。因此快照水位只能作为下界合并，不能覆盖之后
 * 已经收到的更高实时水位。
 */
function seedPeerReadWatermarks(
  readWatermarks: Record<string, Record<string, number>>,
  conversations: ChatConversationDto[],
): Record<string, Record<string, number>> {
  let next = readWatermarks;
  for (const conversation of conversations) {
    if (conversation.type !== 'DIRECT') continue;
    const peerId = conversation.peer?.id;
    const height = conversation.peerReadHeight;
    if (
      !peerId ||
      !Number.isSafeInteger(height) ||
      (height as number) < 0
    ) {
      continue;
    }
    const prior = next[conversation.id]?.[peerId] ?? 0;
    if ((height as number) <= prior) continue;
    if (next === readWatermarks) next = { ...readWatermarks };
    next[conversation.id] = {
      ...(next[conversation.id] ?? {}),
      [peerId]: height as number,
    };
  }
  return next;
}

let burnPurgeTimer: ReturnType<typeof setTimeout> | null = null;

function clearBurnPurgeTimer(): void {
  if (burnPurgeTimer) clearTimeout(burnPurgeTimer);
  burnPurgeTimer = null;
}

function scheduleNextBurnPurge(
  nextExpiryAt: number | null,
  hasSelfDestructPolicy: boolean,
): void {
  clearBurnPurgeTimer();
  if (!hasSelfDestructPolicy) return;
  const delay = Math.min(
    nextExpiryAt === null
      ? BURN_PURGE_SWEEP_MS
      : Math.max(1, nextExpiryAt - Date.now() + 1),
    BURN_PURGE_SWEEP_MS,
  );
  burnPurgeTimer = setTimeout(() => {
    burnPurgeTimer = null;
    void useChatStore.getState().purgeExpiredBurnMessages();
  }, delay);
}

/**
 * store 里的消息 = 线上 DTO + 客户端本地态:
 * failed 只在乐观消息(height=0)发送失败时置位,永不上行。
 */
export type StoredChatMessage = ChatMessageDto & {
  failed?: boolean;
  /**
   * 点击发送那一刻会话里的最大 height —— 「这次发送发生在第几条之后」。
   *
   * 发送中仍临时置底；一旦失败，气泡回到这个服务端位置。会话预览的
   * 「发送失败」前缀也用它判断这次失败是不是最新一次尝试。不能拿 createdAt
   * 比:失败气泡是设备时钟、已确认消息是服务端时钟,跨域比大小会让时钟快的
   * 设备一直挂着撤不掉的前缀。详见 features/messages/utils/failed-preview。
   */
  failedAfterHeight?: number;
};

/** 某成员的全局阅后即焚策略（按会话缓存，收到实时变更后立即覆盖）。 */
export type GlobalBurnPolicy = {
  userId: string;
  durationSec: number;
  startedAt: string | null;
};

interface ChatStoreState {
  connected: boolean;
  connecting: boolean;
  /** 最近一次连接失败的原因文案(消息页空态提示用)。 */
  error: string | null;
  currentUserId: string | null;
  /** 当前查看者的全局阅后即焚窗口（秒）；0 表示关闭。 */
  viewerSelfDestructSec: number;
  /** 全局阅后即焚开启时间；开启前的消息不受策略影响。 */
  viewerSelfDestructStartedAt: string | null;
  /** 本地权威写入递增，防止较早发出的策略 GET 覆盖设置页刚保存的值。 */
  viewerSelfDestructPolicyRevision: number;
  /** 每次有效自毁策略切换都会前进，用于使媒体磁盘缓存失效。 */
  selfDestructPolicyEpoch: number;
  conversations: ChatConversationDto[];
  /** 会话成员的全局阅后即焚策略；0 表示该成员已关闭。 */
  globalBurnPoliciesByConversation: Record<
    string,
    Record<string, GlobalBurnPolicy>
  >;
  messagesByConversation: Record<string, ChatMessageDto[]>;
  activeConversationId: string | null;
  /** 在线状态表(chat:presence 查询与广播共同维护)。 */
  onlineByUser: Record<string, boolean>;

  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentUserId: (userId: string | null) => void;
  setViewerSelfDestructSec: (
    seconds: number,
    options?: { remoteRefresh?: boolean },
    startedAt?: string | null,
  ) => void;
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
  /**
   * 把会话预览重算成时间线里最后一条权威消息:发送失败后回滚乐观写入,
   * 或补拉换掉了同 id 的合成确认之后让预览跟上时间线。
   */
  revertConversationPreview: (conversationId: string) => void;
  /** 本端已读的乐观归零(socket 上报之外的即时 UI 反馈)。 */
  markConversationReadLocal: (conversationId: string) => void;
  /** 乐观消息发送失败:按 d 标记,气泡转失败态。 */
  markMessageFailed: (conversationId: string, d: string) => void;
  /** 重发开始:失败气泡回到「发送中」(清 failed,sendStatus 3→1)。 */
  markMessageRetrying: (conversationId: string, d: string) => void;
  /** 本地删除一条消息(仅本端视图;服务端删除随后续批次)。 */
  removeMessage: (conversationId: string, messageId: string) => void;
  /**
   * 只从内存窗口里驱逐一段旧消息,**不写删除墓碑**。
   * 冷缓存缺口过大时的作废路径用 —— 走 removeMessage 会把这些完全正常的
   * 服务端消息永久标成「用户删过」,此后翻页和搜索里再也见不到。
   */
  evictMessagesBelow: (conversationId: string, height: number) => void;
  /**
   * 焚毁到期的本地清理。
   *
   * 服务端 sweeper 把过期消息物删了,本地缓存却无从得知:既没有到期元数据,
   * 也没有删除事件,后续 REST 页「少了哪些行」同样对不出来。不主动清的话,
   * 冷启动水合与本地 FTS 搜索仍然能把本该烧掉的正文端出来 —— 阅后即焚在
   * 本地这一侧等于没生效。拿到会话快照与档位变更时各清一次。
   */
  purgeExpiredBurnMessages: () => Promise<void>;
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
    burnStartedAt?: string | null,
  ) => void;
  applyGlobalBurnPolicy: (
    conversationId: string,
    userId: string,
    durationSec: number,
    startedAt: string | null,
  ) => void;
  /** 服务端焚毁通知的本地落地（双方设备实时收敛）。 */
  applyBurnedMessages: (
    conversationId: string,
    messageIds: readonly string[],
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
  if (message.height > 0) return message.height;
  const local = message as StoredChatMessage;
  // 失败消息固定在点击发送时的服务端水位后面；后续抵达的真消息继续排在它下面。
  if (local.failed && Number.isFinite(local.failedAfterHeight)) {
    return (local.failedAfterHeight ?? 0) + 0.5;
  }
  // 仍在发送中的本地乐观消息临时置底，内部按发送时间稳定排序。
  return Number.MAX_SAFE_INTEGER / 2 + Date.parse(message.createdAt);
}

function latestConfirmedHeight(messages: ChatMessageDto[]): number {
  let latest = 0;
  for (const message of messages) {
    if (message.height > latest) latest = message.height;
  }
  return latest;
}

/**
 * 发送时拿不到水位的失败气泡(转发/分享进从未打开过的会话,见 client 的
 * captureSendAnchor)在这里补锚:第一批抵达的已确认消息几乎总是用户打开会话
 * 时拉的那页历史,都发生在这次发送之前,所以锚在它们的最大 height 后面。
 * 不补的话它会一直沉底,而预览前缀在任何真消息到达后就再也不提示。
 */
function resolveUnknownFailureAnchors(
  messages: ChatMessageDto[],
): ChatMessageDto[] {
  const latest = latestConfirmedHeight(messages);
  if (latest === 0) return messages;
  return messages.map((message) => {
    const local = message as StoredChatMessage;
    if (!local.failed || Number.isFinite(local.failedAfterHeight)) return message;
    return { ...local, failedAfterHeight: latest };
  });
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
  const merged = resolveUnknownFailureAnchors([...byId.values()]).sort(
    (a, b) => sortKey(a) - sortKey(b),
  );
  if (merged.length <= cap) return merged;
  // 截断只淘汰已确认消息,失败气泡不占名额也不被挤掉。它锚在点击发送时的
  // 旧水位上,之后每来一条新消息就往窗口顶部退一格;而 height=0 的行从不落
  // messages 表 —— 一旦被截掉,气泡连同会话列表的「发送失败」前缀就一起
  // 消失,要到冷启动从 outbox 回放才重新出现。
  const isFailed = (message: ChatMessageDto): boolean =>
    (message as StoredChatMessage).failed === true;
  let confirmedCount = 0;
  for (const message of merged) {
    if (!isFailed(message)) confirmedCount += 1;
  }
  let toDrop = confirmedCount - cap;
  if (toDrop <= 0) return merged;
  return merged.filter((message) => {
    if (toDrop <= 0 || isFailed(message)) return true;
    toDrop -= 1;
    return false;
  });
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

/**
 * 本地冷启动时，会话行和消息时间线是分开读取的。旧版本只把两者分别灌进
 * store，导致「会话存在但 lastMessage 为空」的行一直空到用户打开会话。
 * 这里只在还没有服务端全量快照时补缺失预览；一旦快照到手，null 就是服务端
 * 的权威结果（可能代表清空/焚毁），不能被旧缓存重新带回来。
 */
function hydratePreviewFromLocalTimeline(
  conversation: ChatConversationDto,
  timeline: ChatMessageDto[] | undefined,
  clearedFloor: number,
): ChatConversationDto {
  if (conversation.lastMessage || !timeline || timeline.length === 0) {
    return conversation;
  }
  let latest: ChatMessageDto | null = null;
  for (const message of timeline) {
    if (
      message.height <= 0 ||
      message.height <= clearedFloor ||
      isMessageDeletedLocally(message.id, message.d)
    ) {
      continue;
    }
    if (!latest || message.height > latest.height) latest = message;
  }
  if (!latest) return conversation;
  return {
    ...conversation,
    lastMessage: latest,
    lastMessageAt: latest.createdAt,
  };
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
  viewerSelfDestructSec: 0,
  viewerSelfDestructStartedAt: null,
  viewerSelfDestructPolicyRevision: 0,
  selfDestructPolicyEpoch: 0,
  conversations: [],
  globalBurnPoliciesByConversation: {},
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
  setViewerSelfDestructSec: (seconds, options, startedAt) => {
    const normalized = normalizeViewerSelfDestructSec(seconds);
    if (normalized === null) return;
    const {
      currentUserId,
      viewerSelfDestructSec,
      viewerSelfDestructPolicyRevision,
      selfDestructPolicyEpoch,
    } = get();
    if (currentUserId) {
      try {
        storage.set(
          viewerSelfDestructSecStorageKey(currentUserId),
          String(normalized),
        );
      } catch {
        // 缓存策略写失败不应影响隐私设置保存；本次进程仍立即执行清理。
      }
    }
    // 设置页/缓存初始化是本地权威写入；远程刷新只有在 socket manager 确认
    // 期间没有新写入时才带 remoteRefresh 标记落进来。
    set({
      viewerSelfDestructSec: normalized,
      viewerSelfDestructStartedAt:
        startedAt !== undefined
          ? startedAt
          : viewerSelfDestructSec === normalized
            ? get().viewerSelfDestructStartedAt
            : null,
      viewerSelfDestructPolicyRevision: options?.remoteRefresh
        ? viewerSelfDestructPolicyRevision
        : viewerSelfDestructPolicyRevision + 1,
      selfDestructPolicyEpoch:
        viewerSelfDestructSec === normalized
          ? selfDestructPolicyEpoch
          : selfDestructPolicyEpoch + 1,
    });
    if (viewerSelfDestructSec !== normalized || !options?.remoteRefresh) {
      void get().purgeExpiredBurnMessages();
    }
  },
  applyGlobalBurnPolicy: (conversationId, userId, durationSec, startedAt) => {
    const normalized = isBurnDurationChoice(durationSec) ? durationSec : 0;
    const current = get().globalBurnPoliciesByConversation[conversationId]?.[
      userId
    ];
    if (
      current?.durationSec === normalized &&
      current.startedAt === startedAt
    ) {
      return;
    }
    set({
      globalBurnPoliciesByConversation: {
        ...get().globalBurnPoliciesByConversation,
        [conversationId]: {
          ...(get().globalBurnPoliciesByConversation[conversationId] ?? {}),
          [userId]: { userId, durationSec: normalized, startedAt },
        },
      },
      selfDestructPolicyEpoch: get().selfDestructPolicyEpoch + 1,
    });
    // 自己在另一台设备上改设置时，同一事件也要更新本设备的全局策略。
    if (get().currentUserId === userId) {
      get().setViewerSelfDestructSec(
        normalized,
        { remoteRefresh: true },
        startedAt,
      );
    }
    void get().purgeExpiredBurnMessages();
  },
  applyBurnedMessages: (conversationId, messageIds) => {
    const ids = new Set(
      messageIds.filter(
        (messageId): messageId is string =>
          typeof messageId === 'string' && messageId.length > 0,
      ),
    );
    if (ids.size === 0) return;
    const { messagesByConversation, conversations } = get();
    const timeline = messagesByConversation[conversationId] ?? [];
    const nextTimeline = timeline.filter((message) => !ids.has(message.id));
    const index = conversations.findIndex((c) => c.id === conversationId);
    const target = index >= 0 ? conversations[index] : null;
    const previewBurned = target?.lastMessage
      ? ids.has(target.lastMessage.id)
      : false;
    if (nextTimeline.length === timeline.length && !previewBurned) {
      // 仍然执行数据库删除：消息可能尚未被当前内存窗口加载。
      void deleteLocalMessages(conversationId, [...ids]);
      return;
    }
    const replacement = nextTimeline[nextTimeline.length - 1] ?? null;
    const nextConversation =
      target && previewBurned
        ? {
            ...target,
            lastMessage: replacement,
            lastMessageAt: replacement?.createdAt ?? null,
          }
        : null;
    set({
      ...(nextTimeline.length !== timeline.length
        ? {
            messagesByConversation: {
              ...messagesByConversation,
              [conversationId]: nextTimeline,
            },
          }
        : {}),
      ...(nextConversation
        ? {
            conversations: sortConversations([
              ...conversations.slice(0, index),
              nextConversation,
              ...conversations.slice(index + 1),
            ]),
          }
        : {}),
    });
    void deleteLocalMessages(conversationId, [...ids]);
    if (nextConversation) void upsertLocalConversation(nextConversation);
  },
  setConversations: (conversations) => {
    const {
      conversations: currentConversations,
      messagesByConversation,
      readWatermarks,
      currentUserId,
      clearedBeforeHeightByConversation,
      selfDestructPolicyEpoch,
    } = get();
    const burnPolicyChanged = hasBurnPolicyChanged(
      currentConversations,
      conversations,
    );
    const seededReadWatermarks = seedPeerReadWatermarks(
      readWatermarks,
      conversations,
    );
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
      readWatermarks: seededReadWatermarks,
      ...(burnPolicyChanged
        ? { selfDestructPolicyEpoch: selfDestructPolicyEpoch + 1 }
        : {}),
    });
    // 快照带着每个会话当前的焚毁档位 —— 顺手把已到期的本地缓存清掉。
    void get().purgeExpiredBurnMessages();
    // G-01:快照落盘(fire-and-forget,本地库失败不影响主链路)。
    void persistLocalConversations(get().conversations);
  },
  upsertConversation: (conversation) => {
    const { conversations, messagesByConversation, readWatermarks } = get();
    const rest = conversations.filter((c) => c.id !== conversation.id);
    const reconciled = reconcileDeletedPreview(
      conversation,
      messagesByConversation[conversation.id],
    );
    set({
      conversations: sortConversations([...rest, reconciled]),
      readWatermarks: seedPeerReadWatermarks(readWatermarks, [reconciled]),
    });
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
   * 会话元信息不覆盖已经到手的服务端数据；消息时间线随后到达时，只补本地
   * 快照里缺失的预览。
   */
  hydrateLocalSnapshot: (conversations, messagesByConversation) => {
    const state = get();
    // 服务端快照一旦成功，null 预览就是权威值，不能被本地旧时间线覆盖。
    if (!state.conversationsSnapshotLoaded && conversations.length > 0) {
      const localById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
      const withLocalPreviews = conversations.map((conversation) =>
        hydratePreviewFromLocalTimeline(
          conversation,
          messagesByConversation[conversation.id],
          state.clearedBeforeHeightByConversation[conversation.id] ?? 0,
        ),
      );
      if (state.conversations.length === 0) {
        set({ conversations: sortConversations(withLocalPreviews) });
      } else {
        const merged = state.conversations.map((current) => {
          const local = localById.get(current.id);
          if (!local) return current;
          const hydrated = hydratePreviewFromLocalTimeline(
            local,
            messagesByConversation[current.id],
            state.clearedBeforeHeightByConversation[current.id] ?? 0,
          );
          if (current.lastMessage || !hydrated.lastMessage) return current;
          return {
            ...current,
            lastMessage: hydrated.lastMessage,
            lastMessageAt: hydrated.lastMessageAt,
          };
        });
        if (merged.some((conversation, index) => conversation !== state.conversations[index])) {
          set({ conversations: sortConversations(merged) });
        }
      }
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
    // 冷启动这一刻最要紧:离线期间服务端 sweeper 早把过期消息物删了,
    // 而本地库原样留着 —— 不清的话开 App 第一眼看到的就是本该烧掉的内容。
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
    // 按引用而不是按 id 比:无回声确认先把合成品写进预览,随后补拉的权威消息
    // 在时间线里替换的是**同 id** 的另一个对象。只比 id 的话预览会一直指着合成品
    // (源对象的签名 url、没有 key),补拉等于白拉。
    if (target.lastMessage === authoritative) return;
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
    const pending = existing[index] as StoredChatMessage;
    // 发送侧(文本与媒体都是)在点击发送时就预捕获水位。没有预捕获值的只有
    // 两种:旧版 outbox 回放的行,以及发送时时间线没加载、会话列表也给不出
    // lastMessage.height 的会话(转发/分享进从未打开过的会话)。这里按失败
    // 那一刻的时间线补齐;时间线仍然一条已确认消息都没有就保持未知,交给
    // mergeMessages 在第一批真消息抵达时补锚 —— 写死 0 的话,拉到真历史后
    // 0+0.5 会把气泡顶到整段历史最上面,预览前缀也随之消失。
    const latest = latestConfirmedHeight(existing);
    const failedAfterHeight = Number.isFinite(pending.failedAfterHeight)
      ? pending.failedAfterHeight
      : latest > 0
        ? latest
        : undefined;
    const next: StoredChatMessage = {
      ...pending,
      failed: true,
      ...(failedAfterHeight === undefined ? {} : { failedAfterHeight }),
    };
    const messages = [
      ...existing.slice(0, index),
      next,
      ...existing.slice(index + 1),
    ].sort((a, b) => sortKey(a) - sortKey(b));
    set({
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: messages,
      },
    });
  },

  markMessageRetrying: (conversationId, d) => {
    const { messagesByConversation } = get();
    const existing = messagesByConversation[conversationId] ?? [];
    const index = existing.findIndex(
      (m) => m.d === d && m.height === 0 && (m as StoredChatMessage).failed,
    );
    if (index < 0) return;
    const { failed: _failed, ...rest } = existing[index] as StoredChatMessage;
    // 重发是一次新的发送位置；若再次失败，应停在重发时所在的位置。
    // 水位只进不退:时间线当前没有已确认消息(窗口被截空/没加载)时,
    // 保住原来的锚点(含「未知」),别退回 0 把气泡顶到历史最上面。
    const anchor = Math.max(
      latestConfirmedHeight(existing),
      rest.failedAfterHeight ?? 0,
    );
    const retrying: StoredChatMessage = {
      ...rest,
      ...(anchor > 0 ? { failedAfterHeight: anchor } : {}),
    };
    const messages = [
      ...existing.slice(0, index),
      retrying,
      ...existing.slice(index + 1),
    ].sort((a, b) => sortKey(a) - sortKey(b));
    set({
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: messages,
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

  applyBurnDuration: (conversationId, burnDurationSec, burnStartedAt) => {
    const { conversations, selfDestructPolicyEpoch } = get();
    const index = conversations.findIndex((c) => c.id === conversationId);
    if (index < 0) return;
    const current = conversations[index];
    // 同一档位重新开启时 startedAt 会变，不能因为 duration 没变就短路；
    // 否则另一端会继续沿用旧的开启时间，误删本次开启前的消息。
    const nextStartedAt =
      burnStartedAt !== undefined
        ? burnStartedAt
        : burnDurationSec === null
          ? null
          : (current.burnStartedAt ?? null);
    if (
      (current.burnDurationSec ?? null) === burnDurationSec &&
      (current.burnStartedAt ?? null) === nextStartedAt
    ) {
      return;
    }
    set({
      conversations: [
        ...conversations.slice(0, index),
        {
          ...current,
          burnDurationSec,
          burnStartedAt: nextStartedAt,
        },
        ...conversations.slice(index + 1),
      ],
      selfDestructPolicyEpoch: selfDestructPolicyEpoch + 1,
    });
    void get().purgeExpiredBurnMessages();
  },

  purgeExpiredBurnMessages: async () => {
    const {
      conversations,
      messagesByConversation,
      viewerSelfDestructSec,
      viewerSelfDestructStartedAt,
      globalBurnPoliciesByConversation,
    } = get();
    let nextTimelines: Record<string, ChatMessageDto[]> | null = null;
    let nextConversations: ChatConversationDto[] | null = null;
    const durablePreviewWrites: Promise<void>[] = [];
    const localPurges: { conversationId: string; cutoff: Date; startedAt: Date }[] = [];
    let nextExpiryAt: number | null = null;
    const viewerSeconds =
      viewerSelfDestructSec > 0 ? viewerSelfDestructSec : null;
    const viewerStartMs = viewerSelfDestructStartedAt
      ? Date.parse(viewerSelfDestructStartedAt)
      : NaN;
    const now = Date.now();
    for (const conversation of conversations) {
      const conversationSeconds =
        conversation.burnDurationSec && conversation.burnDurationSec > 0
          ? conversation.burnDurationSec
          : null;
      const burnStartMs = conversation.burnStartedAt
        ? Date.parse(conversation.burnStartedAt)
        : NaN;
      const burnStart = Number.isFinite(burnStartMs)
        ? new Date(burnStartMs)
        : null;
      const burnCutoff = conversationSeconds
        ? new Date(now - conversationSeconds * 1000)
        : null;
      const globalWindows = Object.values(
        globalBurnPoliciesByConversation[conversation.id] ?? {},
      ).filter(
        (policy): policy is GlobalBurnPolicy & { startedAt: string } =>
          policy.durationSec > 0 && typeof policy.startedAt === 'string',
      );
      const timeline = messagesByConversation[conversation.id];
      if (conversationSeconds && burnStart && burnCutoff) {
        localPurges.push({
          conversationId: conversation.id,
          cutoff: burnCutoff,
          startedAt: burnStart,
        });
      }
      for (const policy of globalWindows) {
        const startedAtMs = Date.parse(policy.startedAt);
        if (!Number.isFinite(startedAtMs)) continue;
        localPurges.push({
          conversationId: conversation.id,
          cutoff: new Date(now - policy.durationSec * 1000),
          startedAt: new Date(startedAtMs),
        });
      }
      const kept = (timeline ?? []).filter((m) => {
        const createdAt = Date.parse(m.createdAt);
        if (!Number.isFinite(createdAt)) return true;
        const expiries: number[] = [];
        if (conversationSeconds && Number.isFinite(burnStartMs) && createdAt >= burnStartMs) {
          expiries.push(createdAt + conversationSeconds * 1000);
        }
        if (viewerSeconds && Number.isFinite(viewerStartMs) && createdAt >= viewerStartMs) {
          expiries.push(createdAt + viewerSeconds * 1000);
        }
        for (const policy of globalWindows) {
          const startedAtMs = Date.parse(policy.startedAt);
          if (Number.isFinite(startedAtMs) && createdAt >= startedAtMs) {
            expiries.push(createdAt + policy.durationSec * 1000);
          }
        }
        return expiries.length === 0 || Math.min(...expiries) > now;
      });
      const preview = conversation.lastMessage;
      const schedulableMessages =
        preview && !kept.some((message) => message.id === preview.id)
          ? [...kept, preview]
          : kept;
      for (const message of schedulableMessages) {
        const createdAt = Date.parse(message.createdAt);
        if (!Number.isFinite(createdAt)) continue;
        const expiries: number[] = [];
        if (conversationSeconds && Number.isFinite(burnStartMs) && createdAt >= burnStartMs) {
          expiries.push(createdAt + conversationSeconds * 1000);
        }
        if (viewerSeconds && Number.isFinite(viewerStartMs) && createdAt >= viewerStartMs) {
          expiries.push(createdAt + viewerSeconds * 1000);
        }
        for (const policy of globalWindows) {
          const startedAtMs = Date.parse(policy.startedAt);
          if (Number.isFinite(startedAtMs) && createdAt >= startedAtMs) {
            expiries.push(createdAt + policy.durationSec * 1000);
          }
        }
        const expiresAt = expiries.length > 0 ? Math.min(...expiries) : null;
        if (expiresAt !== null && expiresAt > now && (nextExpiryAt === null || expiresAt < nextExpiryAt)) {
          nextExpiryAt = expiresAt;
        }
      }
      if (timeline?.length && kept.length !== timeline.length) {
        nextTimelines ??= { ...messagesByConversation };
        nextTimelines[conversation.id] = kept;
      }

      if (preview && !kept.some((message) => message.id === preview.id)) {
        const replacement = kept.length > 0 ? kept[kept.length - 1] : null;
        const sanitized = {
          ...conversation,
          lastMessage: replacement,
          lastMessageAt: replacement?.createdAt ?? null,
          // 在下一份服务器快照到来前，不能让已过期预览继续带着幽灵红点。
          unreadCount: 0,
        };
        nextConversations ??= [...conversations];
        const index = nextConversations.findIndex(
          (candidate) => candidate.id === conversation.id,
        );
        if (index >= 0) nextConversations[index] = sanitized;
        durablePreviewWrites.push(upsertLocalConversation(sanitized));
      }
    }
    if (nextTimelines || nextConversations) {
      set({
        ...(nextTimelines
          ? { messagesByConversation: nextTimelines }
          : {}),
        ...(nextConversations
          ? { conversations: sortConversations(nextConversations) }
          : {}),
      });
    }
    scheduleNextBurnPurge(
      nextExpiryAt,
      Number.isFinite(viewerStartMs) ||
        conversations.some(
          (conversation) =>
            (conversation.burnDurationSec ?? 0) > 0 &&
            Boolean(conversation.burnStartedAt),
        ) ||
        Object.values(globalBurnPoliciesByConversation).some((policies) =>
          Object.values(policies).some(
            (policy) =>
              policy.durationSec > 0 &&
              typeof policy.startedAt === 'string' &&
              Number.isFinite(Date.parse(policy.startedAt)),
          ),
        ),
    );
    await Promise.all([
      purgeExpiredLocalMessages(
        localPurges,
        viewerSeconds === null
          ? undefined
          : new Date(now - viewerSeconds * 1000),
        Number.isFinite(viewerStartMs) ? new Date(viewerStartMs) : undefined,
      ),
      ...durablePreviewWrites,
    ]);
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
        // convergeUnread 无变化时返回 undefined,而 zustand 的 set 是
        // Object.assign 合并:带着 conversations:undefined 这个**自有键**进去
        // 会把整份会话列表覆盖成 undefined,之后 selectTotalUnread 之类
        // 直接 `.reduce of undefined` 抛错(抛在 set 的同步订阅里,表现为
        // 「read handler failed」),列表也空到下一次全量拉取为止。
        const converged = convergeUnread(
          conversations,
          index,
          get().messagesByConversation[conversationId] ?? [],
          height,
          currentUserId,
        );
        if (converged) patch.conversations = converged;
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
      globalBurnPoliciesByConversation: {},
      conversationsSnapshotLoaded: false,
      messagesByConversation: {},
      messageWindowByConversation: {},
      clearedBeforeHeightByConversation: {},
      activeConversationId: null,
      readWatermarks: {},
      deliveredWatermarks: {},
      typingUntilByConversation: {},
    }),

  reset: () => {
    clearBurnPurgeTimer();
    set({
      connected: false,
      connecting: false,
      error: null,
      currentUserId: null,
      viewerSelfDestructSec: 0,
      viewerSelfDestructStartedAt: null,
      viewerSelfDestructPolicyRevision: 0,
      selfDestructPolicyEpoch: 0,
      conversations: [],
      globalBurnPoliciesByConversation: {},
      conversationsSnapshotLoaded: false,
      messagesByConversation: {},
      messageWindowByConversation: {},
      clearedBeforeHeightByConversation: {},
      activeConversationId: null,
      onlineByUser: {},
      readWatermarks: {},
      deliveredWatermarks: {},
      typingUntilByConversation: {},
    });
  },
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
