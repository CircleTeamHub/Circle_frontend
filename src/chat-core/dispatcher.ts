import { Alert, unstable_batchedUpdates } from 'react-native';
import type { Socket } from 'socket.io-client';
import {
  CHAT_EVENTS,
  isChatMessageDto,
  type ChatConversationBroadcast,
  type ChatHistoryClearedBroadcast,
  type ChatMessageDto,
  type ChatPresenceBroadcast,
  type ChatReadBroadcast,
  type ChatTypingBroadcast,
  type ChatDeliveredBroadcast,
  type ChatBurnedMessagesBroadcast,
  type ChatEditBroadcast,
  type ChatReactionBroadcast,
  type ChatRevokeBroadcast,
} from './protocol';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
import { reportError } from '@/observability/sentry';
import { allowPeerMediaUrl } from '@/services/api/utils';
import i18n from '@/i18n';
import { loadChatConversations } from './api';
import { dismissChatNotifications } from './chat-notifications';
import { isMessageDeletedLocally } from './deleted-messages';
import { reportChatDelivered } from './socket-manager';
import { getChatMessagePreview } from './mappers';
import { useChatStore } from './store';
import { noteLiveRevision } from './sync';
import { useLocalUnreadStore } from '@/features/messages/store/use-local-unread-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { devWarn } from '@/utils/dev-log';

/**
 * 服务端事件 → store 的分发层（squady RealtimeEventDispatcher 的移植）。
 * 每个处理器独立 try/catch：单条畸形载荷只丢弃自身，
 * 不能让异常传回 socket.io 事件循环拖垮连接。
 *
 * isLive: session generation 检查 —— 登出后到达的事件一律丢弃，
 * 防止上一个账号的在途数据写进下一个账号的 store。
 */
/** 会话补拉的合并窗口:消息洪泛时不要每条都打一次全量列表。 */
const CONVERSATION_BACKFILL_DEBOUNCE_MS = 800;
/**
 * 同一 JS 事件循环里的消息洪峰只留一个 trailing flush。
 * 24ms 约等于两帧之间的窗口，能把 Socket.IO 连续投递的消息合成一次
 * store 更新，同时不会让单条消息在前台出现可感知的等待。
 */
const INCOMING_MESSAGE_BATCH_WINDOW_MS = 24;
let backfillTimer: ReturnType<typeof setTimeout> | null = null;
let incomingMessageBatchTimer: ReturnType<typeof setTimeout> | null = null;
let incomingMessageBatch: ChatMessageDto[] = [];
let incomingMessageIsLive: (() => boolean) | null = null;
/** 会话元信息在事件到达时缺失；flush 时即使补拉先把它带回也仍只弹最新一条。 */
const incomingMissingConversationIds = new Set<string>();
const reportedChatEventFailures = new Set<string>();

/**
 * A burst of image messages otherwise notifies every chat subscriber twice per
 * message (preview then timeline). Older test/web runtimes do not expose the
 * native helper, so keep a synchronous fallback.
 */
function batchStoreUpdates<T>(work: () => T): T {
  if (typeof unstable_batchedUpdates === 'function') {
    return unstable_batchedUpdates(work);
  }
  return work();
}

function reportChatEventFailureOnce(operation: string, kind: string): void {
  const signature = `${operation}:${kind}`;
  if (reportedChatEventFailures.has(signature)) return;
  reportedChatEventFailures.add(signature);
  reportError(new Error('chat event failure'), {
    component: 'chatDispatcher',
    operation,
    kind,
  });
}

/**
 * 等会话元信息的横幅候选(conversationId → 该会话最新一条)。
 *
 * 陌生人的第一条消息、刚被拉进的群:会话还不在快照里,标题/头像/跳转目标
 * 一个都拼不出来。原来的做法是从会话 id 的形状猜「这是不是 1:1」,猜中就用
 * 发送者信息凑一条 —— 而会话 id 其实是不透明 UUID,那条分支永远走不到,
 * 结果就是这两种情况**从来没有横幅**。改成先攒着,等补拉把元信息带回来再弹。
 */
type PendingBanner = {
  message: ChatMessageDto;
  /**
   * 认领它的那次补拉的序号;还没被认领时为 null。
   *
   * 必须是**精确归属**,不能写成「arrivedAfter < 本次序号」那种累积判定:
   * 累积判定下第 2 次补拉同时占有第 0、1 代的候选,于是「第 2 次先失败、
   * 第 1 次后成功」这个顺序里,第 2 次的 catch 会顺手删掉第 1 次本来能服务的
   * 那条 —— 元信息随后到了,横幅却已经没了。一个候选只能属于一次请求。
   */
  owner: number | null;
};

const pendingBanners = new Map<string, PendingBanner>();
/** 攒的是会话数不是消息数;超了丢最早的会话,免得离线洪泛把它撑成内存泄漏。 */
const PENDING_BANNER_CONVERSATIONS_MAX = 20;

/**
 * 已发出的补拉次数,用作候选的归属编号。
 *
 * 需要它是因为 backfillTimer 在请求**发出之前**就被置空了:一次补拉在途时,
 * 另一个陌生会话来消息会再排一次补拉,并把自己的候选加进同一个 map。
 * 两次请求的完成顺序是任意的(后发的可能先失败),所以每个候选必须精确地
 * 只归属一次请求 —— 谁认领谁负责,失败也只丢自己那份。
 */
let issuedBackfills = 0;

function rememberPendingBanner(message: ChatMessageDto): void {
  // 同一会话只留最新一条:补拉回来弹一条「有新消息」就够,
  // 不该把窗口期内攒的每一条都排进横幅队列。
  pendingBanners.delete(message.conversationId);
  pendingBanners.set(message.conversationId, { message, owner: null });
  while (pendingBanners.size > PENDING_BANNER_CONVERSATIONS_MAX) {
    const oldest = pendingBanners.keys().next().value;
    if (oldest === undefined) break;
    pendingBanners.delete(oldest);
  }
}

/** 请求发出的瞬间把当前还没人认领的候选全部划归它。 */
function claimPendingBanners(issued: number): void {
  for (const entry of pendingBanners.values()) {
    if (entry.owner === null) entry.owner = issued;
  }
}

/** 取出并移除归第 `issued` 次补拉的那批候选;别人的一概不碰。 */
function takePendingBannersFor(issued: number): ChatMessageDto[] {
  const owned: ChatMessageDto[] = [];
  for (const [conversationId, entry] of pendingBanners) {
    if (entry.owner !== issued) continue;
    owned.push(entry.message);
    pendingBanners.delete(conversationId);
  }
  return owned;
}

function scheduleConversationBackfill(isLive: () => boolean): void {
  if (backfillTimer !== null) return;
  backfillTimer = setTimeout(() => {
    backfillTimer = null;
    if (!isLive()) {
      pendingBanners.clear();
      return;
    }
    const issued = (issuedBackfills += 1);
    claimPendingBanners(issued);
    // 触发补拉的事件(陌生会话的消息、群元信息变更)在服务端都已落库,但此刻在途
    // 的列表请求可能发在那之前 —— 复用它等于拿旧快照「刷新」。
    void loadChatConversations({ fresh: true })
      .then(() => {
        const owned = takePendingBannersFor(issued);
        if (!isLive()) return;
        for (const message of owned) {
          // 补拉后仍然认不出会话(已退群/已删好友/后端没返回)就放弃这一条:
          // 继续攒下去只会无限期占着,而它的元信息永远不会来了。
          enqueueForegroundBanner(message);
        }
      })
      .catch((err: unknown) => {
        reportHandledFailure('chatSync', 'conversationBackfill', err);
        // 只丢这一次请求负责的那批:在途期间攒下的候选归下一次补拉,
        // 一次失败不该连累它们。
        takePendingBannersFor(issued);
      });
  }, CONVERSATION_BACKFILL_DEBOUNCE_MS);
}

/** 测试与登出用:丢掉在途的补拉计时器与攒着的横幅。 */
export function cancelConversationBackfill(): void {
  pendingBanners.clear();
  removedConversations.clear();
  reportedChatEventFailures.clear();
  if (backfillTimer !== null) {
    clearTimeout(backfillTimer);
    backfillTimer = null;
  }
  cancelIncomingMessageBatch();
}

/** 测试、登出与切账号用：丢掉尚未 flush 的消息洪峰。 */
function cancelIncomingMessageBatch(): void {
  incomingMessageBatch = [];
  incomingMessageIsLive = null;
  incomingMissingConversationIds.clear();
  if (incomingMessageBatchTimer === null) return;
  clearTimeout(incomingMessageBatchTimer);
  incomingMessageBatchTimer = null;
}

/** 测试用显式 flush；生产由 24ms timer 调用。 */
export function flushIncomingMessageBatch(): void {
  if (incomingMessageBatchTimer !== null) {
    clearTimeout(incomingMessageBatchTimer);
    incomingMessageBatchTimer = null;
  }
  const pending = incomingMessageBatch;
  incomingMessageBatch = [];
  if (pending.length === 0) return;
  processIncomingMessageBatch(pending);
}

/**
 * 被移出的会话(G-11/S-02):服务端已即时离房,但离房前一瞬广播出的消息仍可能
 * 迟到 —— 那条 chat:msg 会因「会话不在快照里」触发补拉,把刚收走的会话又带回
 * 列表。这里记一个有界防复活集合;重新入群(joined)时解除。
 * 断连清空即可:重连后服务端按座位重新派生房间,不在座就收不到了。
 */
const removedConversations = new Map<string, number>();
const REMOVED_CONVERSATIONS_MAX = 50;

function rememberRemovedConversation(conversationId: string): void {
  removedConversations.delete(conversationId);
  // 记下移除那一刻的会话快照序号:自愈判据要拿它区分「移除之后新拉回来的
  // 快照」和「移除之前就已经在途、之后才落地的旧快照」。
  removedConversations.set(
    conversationId,
    useChatStore.getState().conversationsSnapshotSeq,
  );
  while (removedConversations.size > REMOVED_CONVERSATIONS_MAX) {
    const oldest = removedConversations.keys().next().value;
    if (oldest === undefined) break;
    removedConversations.delete(oldest);
  }
}

const CONVERSATION_CHANGE_KINDS: ReadonlySet<string> = new Set([
  'joined',
  'left',
  'removed',
  'updated',
]);

const GROUP_METADATA_CHANGE_KINDS: ReadonlySet<string> = new Set([
  'group-notice-updated',
  'group-avatar-updated',
  'owner-transferred',
]);

function requiresConversationMetadataRefresh(message: ChatMessageDto): boolean {
  return (
    message.type === 'system' &&
    GROUP_METADATA_CHANGE_KINDS.has(String(message.content['kind'] ?? ''))
  );
}

/**
 * 对端(或另一位管理员)改了阅后即焚时长时,把新档位落进会话状态。
 *
 * applyBurnDuration 此前只有本机那次 REST 调用会触发,所以远端改动只是渲染成
 * 一条系统提示 —— ChatInfoScreen 上的档位一直显示旧值,直到某次无关的会话刷新
 * 才对上。对「消息会不会自动销毁」这件事来说,显示错的档位是危险的。
 */
function applyRemoteBurnChange(
  store: ReturnType<typeof useChatStore.getState>,
  message: ChatMessageDto,
): void {
  if (message.type !== 'system') return;
  const content = message.content;
  if (content['kind'] !== 'burn-changed') return;
  const seconds = content['seconds'];
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
  // 新服务端随系统消息带持久化边界，保证改档位不会把旧窗口重置；滚动升级期间
  // 老服务端没带字段时仍以系统消息的服务端时间作为近似边界。
  const persistedStart = content['burnStartedAt'];
  const startedAt =
    seconds <= 0
      ? null
      : typeof persistedStart === 'string' &&
          Number.isFinite(Date.parse(persistedStart))
        ? persistedStart
        : message.createdAt;
  store.applyBurnDuration(
    message.conversationId,
    seconds > 0 ? Math.floor(seconds) : null,
    startedAt,
  );
}

/** 广播里可选的 revision:只认非负安全整数,其余一律当作没给(老后端/畸形载荷)。 */
function optionalRevision(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Live mutation handlers update memory synchronously but may need an async DB
 * write. The sync cursor must advance only after that write succeeds. Older
 * test/compatibility stores return void, which preserves the previous behavior.
 */
function noteLiveMutationRevision(
  conversationId: string,
  revision: number | undefined,
  applied: boolean | Promise<boolean> | undefined,
): void {
  const pending = applied as Promise<boolean> | undefined;
  if (pending && typeof pending.then === 'function') {
    void pending.then(
      (durable) => noteLiveRevision(conversationId, revision, durable),
      () => noteLiveRevision(conversationId, revision, false),
    );
    return;
  }
  noteLiveRevision(conversationId, revision, applied !== false);
}

function applyBurnedMessagesChange(
  store: ReturnType<typeof useChatStore.getState>,
  payload: ChatBurnedMessagesBroadcast,
): void {
  if (
    !payload ||
    typeof payload.conversationId !== 'string' ||
    payload.conversationId.length === 0 ||
    !Array.isArray(payload.messageIds) ||
    payload.messageIds.length === 0 ||
    payload.messageIds.length > 500 ||
    payload.messageIds.some(
      (messageId) =>
        typeof messageId !== 'string' || messageId.length === 0,
    )
  ) {
    throw new Error('malformed burned messages payload');
  }
  const burnedIds = [...new Set(payload.messageIds)];
  store.applyBurnedMessages(payload.conversationId, burnedIds);
  // 消息烧掉了,通知栏里的正文不能还留着。
  dismissChatNotifications(payload.conversationId, burnedIds);
  // revisions 与 messageIds 一一对应;长度对不上就整组不认(游标宁可靠补拉推进)。
  const revisions = payload.revisions;
  if (
    Array.isArray(revisions) &&
    revisions.length === payload.messageIds.length
  ) {
    for (const revision of revisions) {
      noteLiveRevision(payload.conversationId, optionalRevision(revision));
    }
  }
}

/**
 * 群主/管理员改了全员禁言或群策略时,把新状态落进会话 DTO。
 *
 * 系统提示本身就播给整个会话房,所以不用服务端再逐人推 N 条个人房 updated:
 * 客户端收到提示时顺手把 muteAll / policies 翻过来,聊天页的输入区横幅与
 * 群管理页的开关立刻对上;下一次全量拉取会话再兜底校准。
 */
function applyRemoteGroupSettingChange(
  store: ReturnType<typeof useChatStore.getState>,
  message: ChatMessageDto,
): void {
  if (message.type !== 'system') return;
  const content = message.content;
  const kind = content['kind'];
  if (kind !== 'mute-all-changed' && kind !== 'group-policy-changed') return;
  const conversation = store.conversations.find(
    (candidate) => candidate.id === message.conversationId,
  );
  if (!conversation) return;
  const enabled = content['enabled'] === true;
  if (kind === 'mute-all-changed') {
    if (conversation.muteAll === enabled) return;
    store.upsertConversation({ ...conversation, muteAll: enabled });
    return;
  }
  const policy = content['policy'];
  if (typeof policy !== 'string' || !conversation.policies) return;
  // 只认这份 DTO 自己的键:`policy in ...` 会连原型链一起认,一条
  // policy:'toString' 的畸形广播就能给 policies 挂上一个自有的 toString。
  if (!Object.prototype.hasOwnProperty.call(conversation.policies, policy)) {
    return;
  }
  store.upsertConversation({
    ...conversation,
    policies: { ...conversation.policies, [policy]: enabled },
  });
}

function reportDeliveredForIncomingMessage(
  store: ReturnType<typeof useChatStore.getState>,
  payload: ChatMessageDto,
): void {
  // G-07 送达回执:收到别人的消息即回报水位(节流在 socket-manager)。
  // 「已送达」只在单聊里渲染,群聊不报；未知会话照报,服务端按类型丢弃。
  if (
    payload.height > 0 &&
    payload.sender !== null &&
    payload.sender.id !== store.currentUserId &&
    store.conversations.find((c) => c.id === payload.conversationId)?.type !==
      'GROUP'
  ) {
    reportChatDelivered(payload.conversationId, payload.height);
  }
}

/**
 * 将一个消息窗口作为一次 store 更新处理。
 * applyIncomingMessage 仍先于 ingestMessages，避免重复广播被当成新未读；
 * ingest 则按会话合并成一次，底层 persistLocalMessages 因而只起一个批量写。
 */
function processIncomingMessageBatch(messages: ChatMessageDto[]): void {
  if (messages.length === 0 || (incomingMessageIsLive && !incomingMessageIsLive())) {
    return;
  }

  const unique: ChatMessageDto[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const key = `${message.conversationId}:${message.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(message);
  }
  if (unique.length === 0) return;

  const store = useChatStore.getState();
  const appliedById = new Map<string, boolean>();
  const persistedByConversation = new Map<
    string,
    boolean | Promise<boolean> | undefined
  >();
  const grouped = new Map<string, ChatMessageDto[]>();
  for (const message of unique) {
    const group = grouped.get(message.conversationId);
    if (group) group.push(message);
    else grouped.set(message.conversationId, [message]);
  }

  batchStoreUpdates(() => {
    for (const message of unique) {
      // 顺序要紧：先联动会话列表再入时间线。applyIncomingMessage 靠「消息
      // 是否已在时间线里」判重复投递，先 ingest 会让未读重复累加。
      appliedById.set(
        `${message.conversationId}:${message.id}`,
        store.applyIncomingMessage(message),
      );
    }
    for (const [conversationId, batch] of grouped) {
      persistedByConversation.set(
        conversationId,
        store.ingestMessages(conversationId, batch),
      );
    }
  });

  for (const message of unique) {
    const key = `${message.conversationId}:${message.id}`;
    noteLiveMutationRevision(
      message.conversationId,
      message.revision,
      persistedByConversation.get(message.conversationId),
    );
    applyRemoteBurnChange(store, message);
    applyRemoteGroupSettingChange(store, message);
    const metadataChanged = requiresConversationMetadataRefresh(message);
    // 事件到达时没有会话元信息就必须延迟横幅。即使 24ms 窗口内补拉先把
    // 元信息带回，也不能把同一洪峰拆成多条横幅；只保留每会话最新一条。
    const deferredForMissingConversation = incomingMissingConversationIds.has(
      message.conversationId,
    );
    const needsConversation = deferredForMissingConversation
      ? true
      : enqueueForegroundBanner(message) === 'needs-conversation';
    if (deferredForMissingConversation) rememberPendingBanner(message);
    if (needsConversation) rememberPendingBanner(message);
    if (!appliedById.get(key) || needsConversation || metadataChanged) {
      scheduleConversationBackfill(incomingMessageIsLive ?? (() => true));
    }
  }
  for (const conversationId of grouped.keys()) {
    incomingMissingConversationIds.delete(conversationId);
  }
}

export function bindChatEvents(socket: Socket, isLive: () => boolean): void {
  // 当前 socket 生命周期唯一；新绑定时丢掉上一账号尚未落库的窗口。
  cancelIncomingMessageBatch();
  incomingMessageIsLive = isLive;
  socket.on(CHAT_EVENTS.message, (payload: ChatMessageDto) => {
    if (!isLive()) return;
    try {
      // 整份 DTO 都要校验,不能只看两个 id:content=null / height 非法 /
      // sender 形状错的载荷落进 store 之后,炸的是 MessagesScreen 的渲染路径
      // (getChatMessagePreview 读 content['text']),那已经在这个 try/catch
      // 之外了 —— 一条畸形广播就能让消息页每次进都白屏,且它还落了库。
      if (!isChatMessageDto(payload)) {
        devWarn('[chat] dropped malformed message payload');
        reportChatEventFailureOnce('incomingMessage', 'malformedPayload');
        return;
      }
      // 本端删过的消息重复投递时,整条都要在这里丢掉。
      // 只靠 store 里的过滤是不够的:applyIncomingMessage 对墓碑消息返回
      // 「已处理」,而下面的横幅与补拉是无条件跑的 —— 用户离开会话后,
      // 一条自己刚删掉的消息会以前台通知的形式重新弹出来。
      if (isMessageDeletedLocally(payload.id, payload.d)) {
        // 刻意丢掉的也算收到了:不记的话游标停在它前面,1.5 秒后白补拉一趟。
        noteLiveRevision(payload.conversationId, payload.revision);
        return;
      }
      const store = useChatStore.getState();
      // 被移出的会话:迟到的广播不入库也不补拉,否则刚收走的会话立刻复活。
      // 防复活判定必须在排队前完成，避免 24ms 窗口里会话状态变化后误收旧消息。
      const removedAtSeq = removedConversations.get(payload.conversationId);
      if (removedAtSeq !== undefined) {
        const restored =
          store.conversationsSnapshotSeq > removedAtSeq &&
          store.conversations.some((c) => c.id === payload.conversationId);
        if (!restored) return;
        removedConversations.delete(payload.conversationId);
      }
      if (
        !store.conversations.some((c) => c.id === payload.conversationId)
      ) {
        incomingMissingConversationIds.add(payload.conversationId);
      }

      // 送达回执不等入库窗口：收到事件即推进，避免批处理窗口阻塞单聊的已送达状态。
      reportDeliveredForIncomingMessage(store, payload);

      // 第一条保持同步，兼容正在打开的聊天页与旧测试运行时；后续连续事件进入
      // 24ms 窗口，按会话合并一次 apply/ingest，显著减少消息风暴下的 React 与 SQLite 压力。
      if (incomingMessageBatchTimer === null && incomingMessageBatch.length === 0) {
        processIncomingMessageBatch([payload]);
        incomingMessageBatchTimer = setTimeout(() => {
          incomingMessageBatchTimer = null;
          flushIncomingMessageBatch();
        }, INCOMING_MESSAGE_BATCH_WINDOW_MS);
      } else {
        incomingMessageBatch.push(payload);
      }
    } catch (err) {
      devWarn('[chat] message handler failed', err);
      reportChatEventFailureOnce('incomingMessage', 'handlerFailure');
    }
  });

  socket.on(
    CHAT_EVENTS.burnedMessages,
    (payload: ChatBurnedMessagesBroadcast) => {
      if (!isLive()) return;
      try {
        applyBurnedMessagesChange(useChatStore.getState(), payload);
      } catch (err) {
        devWarn('[chat] dropped malformed burned messages payload', err);
        reportChatEventFailureOnce('burnedMessages', 'malformedPayload');
      }
    },
  );

  socket.on(CHAT_EVENTS.read, (payload: ChatReadBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        typeof payload.userId !== 'string' ||
        // 只看 typeof 的话 1.5 / Infinity / NaN 都能过,而这个数会被写进
        // unreadCount,一路传到 tab 与原生角标 API,还会污染已读水位。
        !Number.isSafeInteger(payload.height) ||
        payload.height < 0
      ) {
        devWarn('[chat] dropped malformed read payload');
        reportChatEventFailureOnce('readReceipt', 'malformedPayload');
        return;
      }
      const store = useChatStore.getState();
      store.applyRead(payload.conversationId, payload.userId, payload.height);
      // 本人在别的设备上读过了,这台的通知栏也收起来(对端读到哪与我无关)。
      if (payload.userId === store.currentUserId) {
        dismissChatNotifications(payload.conversationId);
      }
    } catch (err) {
      devWarn('[chat] read handler failed', err);
      reportChatEventFailureOnce('readReceipt', 'handlerFailure');
    }
  });

  socket.on(
    CHAT_EVENTS.historyCleared,
    (payload: ChatHistoryClearedBroadcast) => {
      if (!isLive()) return;
      try {
        if (
          !payload ||
          typeof payload.conversationId !== 'string' ||
          payload.conversationId.length === 0 ||
          typeof payload.clearedBy !== 'string' ||
          payload.clearedBy.length === 0 ||
          !Number.isSafeInteger(payload.clearedBeforeHeight) ||
          payload.clearedBeforeHeight < 0
        ) {
          reportChatEventFailureOnce('historyCleared', 'malformedPayload');
          return;
        }
        useChatStore
          .getState()
          .clearConversationLocal(
            payload.conversationId,
            payload.clearedBeforeHeight,
          );
        useLocalUnreadStore.getState().clearUnread(payload.conversationId);
        dismissChatNotifications(payload.conversationId);
      } catch (err) {
        devWarn('[chat] history-cleared handler failed', err);
        reportChatEventFailureOnce('historyCleared', 'handlerFailure');
      }
    },
  );

  socket.on(CHAT_EVENTS.presence, (payload: ChatPresenceBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.userId !== 'string' ||
        typeof payload.online !== 'boolean'
      ) {
        reportChatEventFailureOnce('presence', 'malformedPayload');
        return;
      }
      const store = useChatStore.getState();
      if (payload.hidden === true) {
        // 对方刚关掉「显示在线时间」:忘掉此人,界面回到「未知」而不是「离线」。
        store.clearPresence(payload.userId);
        return;
      }
      store.applyPresence(
        payload.userId,
        payload.online,
        // 下线广播不带时刻(旧版服务端)= 此刻刚下线;带了就按服务端说的,
        // 包括 null(「显示在线时间」翻回来时服务端可能还没记录过)。
        payload.online
          ? null
          : payload.lastSeenAt === undefined
            ? new Date().toISOString()
            : payload.lastSeenAt,
      );
    } catch (err) {
      devWarn('[chat] presence handler failed', err);
      reportChatEventFailureOnce('presence', 'handlerFailure');
    }
  });

  socket.on(CHAT_EVENTS.typing, (payload: ChatTypingBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        typeof payload.userId !== 'string'
      ) {
        return;
      }
      const store = useChatStore.getState();
      // 服务端 except 的只是发送那只 socket:自己另一台设备的 typing
      // 仍会广播过来,不该给自己看「对方正在输入」。
      if (payload.userId === store.currentUserId) return;
      store.applyTyping(payload.conversationId);
    } catch (err) {
      devWarn('[chat] typing handler failed', err);
      reportChatEventFailureOnce('typing', 'handlerFailure');
    }
  });

  socket.on(CHAT_EVENTS.delivered, (payload: ChatDeliveredBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        typeof payload.userId !== 'string' ||
        !Number.isSafeInteger(payload.height) ||
        payload.height < 0
      ) {
        devWarn('[chat] dropped malformed delivered payload');
        reportChatEventFailureOnce('delivered', 'malformedPayload');
        return;
      }
      useChatStore
        .getState()
        .applyDelivered(payload.conversationId, payload.userId, payload.height);
    } catch (err) {
      devWarn('[chat] delivered handler failed', err);
      reportChatEventFailureOnce('delivered', 'handlerFailure');
    }
  });

  socket.on(CHAT_EVENTS.reaction, (payload: ChatReactionBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        typeof payload.messageId !== 'string' ||
        typeof payload.emoji !== 'string' ||
        typeof payload.userId !== 'string' ||
        (payload.op !== 'add' && payload.op !== 'remove')
      ) {
        devWarn('[chat] dropped malformed reaction payload');
        reportChatEventFailureOnce('reaction', 'malformedPayload');
        return;
      }
      const revision = optionalRevision(payload.revision);
      const applied = useChatStore
        .getState()
        .applyReaction(
          payload.conversationId,
          payload.messageId,
          payload.emoji,
          payload.userId,
          payload.op,
          revision,
        );
      noteLiveMutationRevision(payload.conversationId, revision, applied);
    } catch (err) {
      devWarn('[chat] reaction handler failed', err);
      reportChatEventFailureOnce('reaction', 'handlerFailure');
    }
  });

  socket.on(CHAT_EVENTS.edit, (payload: ChatEditBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        typeof payload.messageId !== 'string' ||
        typeof payload.editedAt !== 'string' ||
        typeof payload.content !== 'object' ||
        payload.content === null
      ) {
        devWarn('[chat] dropped malformed edit payload');
        reportChatEventFailureOnce('edit', 'malformedPayload');
        return;
      }
      const revision = optionalRevision(payload.revision);
      const applied = useChatStore
        .getState()
        .applyEdit(
          payload.conversationId,
          payload.messageId,
          payload.content as Record<string, unknown>,
          payload.editedAt,
          revision,
        );
      noteLiveMutationRevision(payload.conversationId, revision, applied);
    } catch (err) {
      devWarn('[chat] edit handler failed', err);
      reportChatEventFailureOnce('edit', 'handlerFailure');
    }
  });

  socket.on(CHAT_EVENTS.revoke, (payload: ChatRevokeBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        typeof payload.messageId !== 'string' ||
        typeof payload.revokedBy !== 'string'
      ) {
        devWarn('[chat] dropped malformed revoke payload');
        reportChatEventFailureOnce('revoke', 'malformedPayload');
        return;
      }
      const revision = optionalRevision(payload.revision);
      const height = optionalRevision(payload.height);
      const applied = useChatStore
        .getState()
        .applyRevoke(payload.conversationId, payload.messageId, payload.revokedBy, {
          ...(height !== undefined ? { height } : {}),
          ...(payload.senderId === null || typeof payload.senderId === 'string'
            ? { senderId: payload.senderId }
            : {}),
          ...(revision !== undefined ? { revision } : {}),
        });
      noteLiveMutationRevision(payload.conversationId, revision, applied);
      // 撤回之后通知栏里的原文不能还留着。
      dismissChatNotifications(payload.conversationId, [payload.messageId]);
    } catch (err) {
      devWarn('[chat] revoke handler failed', err);
      reportChatEventFailureOnce('revoke', 'handlerFailure');
    }
  });

  socket.on(CHAT_EVENTS.conversation, (payload: ChatConversationBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        payload.conversationId.length === 0 ||
        typeof payload.userId !== 'string' ||
        !CONVERSATION_CHANGE_KINDS.has(payload.kind)
      ) {
        devWarn('[chat] dropped malformed conversation payload');
        reportChatEventFailureOnce('conversation', 'malformedPayload');
        return;
      }
      const store = useChatStore.getState();
      // 个人房定向事件只该是本人的;万一串了宁可丢弃,不替别人操作本机列表。
      if (
        store.currentUserId !== null &&
        payload.userId !== store.currentUserId
      ) {
        return;
      }
      if (payload.kind === 'removed' || payload.kind === 'left') {
        rememberRemovedConversation(payload.conversationId);
        pendingBanners.delete(payload.conversationId);
        const wasActive =
          store.activeConversationId === payload.conversationId;
        store.removeConversation(payload.conversationId);
        // 正开着的那个会话要连时间线一起收走。只摘列表行的话,详情页的消息、
        // 输入框和成员入口原封不动留在屏幕上 —— 已经被移出的人还能继续翻聊天
        // 记录、继续按发送(服务端会拒,但界面上看不出自己已经不在群里)。
        if (wasActive) {
          // null = 只清缓存、不留清空水位:留了的话,以后重新入群时这段
          // 历史会被 ingestMessages 一直挡在外面。
          store.clearConversationLocal(payload.conversationId, null);
          store.setActiveConversationId(null);
        }
        // 正看着这个群被移出才提示;left 是本人在别处的主动动作,静默收走即可。
        if (payload.kind === 'removed' && wasActive) {
          Alert.alert(i18n.t('im.conversation.removedFromGroup'));
        }
        return;
      }
      // joined:重新入群要解除防复活标记;updated 同样只需刷新元信息。
      removedConversations.delete(payload.conversationId);
      scheduleConversationBackfill(isLive);
    } catch (err) {
      devWarn('[chat] conversation handler failed', err);
      reportChatEventFailureOnce('conversation', 'handlerFailure');
    }
  });
}

/**
 * 前台应用内横幅。拆栈时把旧的 chat-snackbar 生产者删掉了,
 * enqueueChatMessage 至今零调用方(NotificationSnackbarHost 仍支持 chat 项),
 * 于是在非会话页收到消息完全没有提示、也没有点进去的入口。
 *
 * 抑制规则:自己发的不弹;当前正打开的那个会话不弹;系统消息不弹;
 * 元信息不足以给出正确标题与跳转目标的不弹。
 *
 * 返回 'needs-conversation' 表示「这条本该弹,但会话元信息还没到」——
 * 调用方据此把它攒起来,等补拉回来再弹(见 pendingBanners)。消息 DTO 里
 * 既没有会话类型也没有圈子名/圈子 id,拿发送者去凑群横幅会弹出错的标题、
 * 点进去还进错房间,所以只能等,不能猜。
 */
function enqueueForegroundBanner(
  message: ChatMessageDto,
): 'enqueued' | 'suppressed' | 'needs-conversation' {
  const store = useChatStore.getState();
  const selfId = store.currentUserId;
  if (selfId !== null && message.sender?.id === selfId) return 'suppressed';
  if (store.activeConversationId === message.conversationId) return 'suppressed';
  if (message.type === 'system') return 'suppressed';

  const conversation = store.conversations.find(
    (c) => c.id === message.conversationId,
  );
  if (!conversation) return 'needs-conversation';
  // 免打扰的会话不弹端内横幅(与推送静音同一语义;未读数照常累计)。
  if (conversation.muted) return 'suppressed';

  const isGroup = conversation.type === 'GROUP';
  // 独立群聊(无 circleId):标题用群名(空名兜底「群聊」),sourceID = 会话 id。
  const title = isGroup
    ? (conversation.circle?.name ??
      (conversation.name?.trim() ||
        i18n.t('messages.newGroupDefaultName', { defaultValue: '群聊' })))
    : (conversation.peer?.nickname ?? message.sender?.nickname ?? '');
  const avatarRaw = isGroup
    ? (conversation.circle?.avatarUrl ?? null)
    : (conversation.peer?.avatarUrl ?? null);
  const sourceID = isGroup
    ? (conversation.circleId ?? conversation.id)
    : (conversation.peer?.id ?? '');

  if (!title || !sourceID) return 'suppressed';
  const summary = isGroup
    ? `${message.sender?.nickname ?? ''}: ${getChatMessagePreview(message)}`.trim()
    : getChatMessagePreview(message);

  useNotificationSnackbarStore.getState().enqueueChatMessage({
    id: message.id,
    title,
    summary,
    // 头像地址仍要过媒体白名单:横幅一出现就会自动发起这次图片请求。
    avatarUrl: allowPeerMediaUrl(avatarRaw),
    conversationID: message.conversationId,
    sourceID,
    conversationType: isGroup ? 'group' : 'private',
  });
  return 'enqueued';
}
