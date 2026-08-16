import { Alert } from 'react-native';
import type { Socket } from 'socket.io-client';
import {
  CHAT_EVENTS,
  isChatMessageDto,
  type ChatConversationBroadcast,
  type ChatMessageDto,
  type ChatPresenceBroadcast,
  type ChatReadBroadcast,
  type ChatTypingBroadcast,
  type ChatDeliveredBroadcast,
  type ChatEditBroadcast,
  type ChatReactionBroadcast,
  type ChatRevokeBroadcast,
} from './protocol';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
import { reportError } from '@/observability/sentry';
import { allowPeerMediaUrl } from '@/services/api/utils';
import i18n from '@/i18n';
import { loadChatConversations } from './api';
import { isMessageDeletedLocally } from './deleted-messages';
import { reportChatDelivered } from './socket-manager';
import { getChatMessagePreview } from './mappers';
import { useChatStore } from './store';

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
let backfillTimer: ReturnType<typeof setTimeout> | null = null;
const reportedChatEventFailures = new Set<string>();

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
    void loadChatConversations()
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
        console.warn('[chat] conversation backfill failed', err);
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
  if (backfillTimer === null) return;
  clearTimeout(backfillTimer);
  backfillTimer = null;
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
  store.applyBurnDuration(
    message.conversationId,
    seconds > 0 ? Math.floor(seconds) : null,
  );
}

export function bindChatEvents(socket: Socket, isLive: () => boolean): void {
  socket.on(CHAT_EVENTS.message, (payload: ChatMessageDto) => {
    if (!isLive()) return;
    try {
      // 整份 DTO 都要校验,不能只看两个 id:content=null / height 非法 /
      // sender 形状错的载荷落进 store 之后,炸的是 MessagesScreen 的渲染路径
      // (getChatMessagePreview 读 content['text']),那已经在这个 try/catch
      // 之外了 —— 一条畸形广播就能让消息页每次进都白屏,且它还落了库。
      if (!isChatMessageDto(payload)) {
        console.warn('[chat] dropped malformed message payload');
        reportChatEventFailureOnce('incomingMessage', 'malformedPayload');
        return;
      }
      // 本端删过的消息重复投递时,整条都要在这里丢掉。
      // 只靠 store 里的过滤是不够的:applyIncomingMessage 对墓碑消息返回
      // 「已处理」,而下面的横幅与补拉是无条件跑的 —— 用户离开会话后,
      // 一条自己刚删掉的消息会以前台通知的形式重新弹出来。
      if (isMessageDeletedLocally(payload.id, payload.d)) return;

      const store = useChatStore.getState();
      // 被移出的会话:迟到的广播不入库也不补拉,否则刚收走的会话立刻复活。
      // 防复活标记的解除有两条路:权威的 joined 事件,或者**移除之后新拉回来的**
      // 会话快照里仍然有它(离线期间被重新拉回群、joined 事件丢了)。
      //
      // 只看「会话在不在列表里」是不牢的:一个在移除事件之前发出、在
      // removeConversation 之后才落地的旧快照会把刚收走的会话原样装回来,
      // 那不是重新入群。所以比快照序号 —— 必须是移除之后又拉过至少一次。
      const removedAtSeq = removedConversations.get(payload.conversationId);
      if (removedAtSeq !== undefined) {
        const restored =
          store.conversationsSnapshotSeq > removedAtSeq &&
          store.conversations.some((c) => c.id === payload.conversationId);
        if (!restored) return;
        removedConversations.delete(payload.conversationId);
      }
      // 顺序要紧:先联动会话列表再入时间线。applyIncomingMessage 靠
      // 「这条消息是否已在时间线里」判重复投递,先 ingest 的话它每次都会
      // 看到自己、未读永远加不上。
      const applied = store.applyIncomingMessage(payload);
      store.ingestMessages(payload.conversationId, [payload]);
      applyRemoteBurnChange(store, payload);
      // G-07 送达回执:收到别人的消息即回报水位(节流在 socket-manager)。
      if (
        payload.height > 0 &&
        payload.sender !== null &&
        payload.sender.id !== store.currentUserId
      ) {
        reportChatDelivered(payload.conversationId, payload.height);
      }
      // 攒下的候选必须有一次补拉去认领它,否则它永远等不到元信息。
      // 这两个条件目前同源(会话不在快照里),但依赖这种巧合太脆,写明。
      const needsConversation =
        enqueueForegroundBanner(payload) === 'needs-conversation';
      if (needsConversation) rememberPendingBanner(payload);
      if (!applied || needsConversation) {
        // 会话不在当前快照里(对方刚建的单聊、刚被拉进的群):消息已经进了
        // 时间线,但没有会话行也没有角标 —— 停在消息页的用户要手动刷新才看得到。
        // 补拉一次会话列表把元信息(对端/群名/头像)带回来。
        scheduleConversationBackfill(isLive);
      }
    } catch (err) {
      console.warn('[chat] message handler failed', err);
      reportChatEventFailureOnce('incomingMessage', 'handlerFailure');
    }
  });

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
        console.warn('[chat] dropped malformed read payload');
        reportChatEventFailureOnce('readReceipt', 'malformedPayload');
        return;
      }
      useChatStore
        .getState()
        .applyRead(payload.conversationId, payload.userId, payload.height);
    } catch (err) {
      console.warn('[chat] read handler failed', err);
      reportChatEventFailureOnce('readReceipt', 'handlerFailure');
    }
  });

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
      useChatStore.getState().applyPresence(payload.userId, payload.online);
    } catch (err) {
      console.warn('[chat] presence handler failed', err);
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
      console.warn('[chat] typing handler failed', err);
    }
  });

  socket.on(CHAT_EVENTS.delivered, (payload: ChatDeliveredBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        typeof payload.userId !== 'string' ||
        typeof payload.height !== 'number'
      ) {
        return;
      }
      useChatStore
        .getState()
        .applyDelivered(payload.conversationId, payload.userId, payload.height);
    } catch (err) {
      console.warn('[chat] delivered handler failed', err);
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
        console.warn('[chat] dropped malformed reaction payload');
        return;
      }
      useChatStore
        .getState()
        .applyReaction(
          payload.conversationId,
          payload.messageId,
          payload.emoji,
          payload.userId,
          payload.op,
        );
    } catch (err) {
      console.warn('[chat] reaction handler failed', err);
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
        console.warn('[chat] dropped malformed edit payload');
        return;
      }
      useChatStore
        .getState()
        .applyEdit(
          payload.conversationId,
          payload.messageId,
          payload.content as Record<string, unknown>,
          payload.editedAt,
        );
    } catch (err) {
      console.warn('[chat] edit handler failed', err);
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
        console.warn('[chat] dropped malformed revoke payload');
        return;
      }
      useChatStore
        .getState()
        .applyRevoke(payload.conversationId, payload.messageId, payload.revokedBy);
    } catch (err) {
      console.warn('[chat] revoke handler failed', err);
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
        console.warn('[chat] dropped malformed conversation payload');
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
      console.warn('[chat] conversation handler failed', err);
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
