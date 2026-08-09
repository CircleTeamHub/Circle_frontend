import type { Socket } from 'socket.io-client';
import {
  CHAT_EVENTS,
  isChatMessageDto,
  type ChatMessageDto,
  type ChatPresenceBroadcast,
  type ChatReadBroadcast,
} from './protocol';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
import { allowPeerMediaUrl } from '@/services/api/utils';
import { loadChatConversations } from './api';
import { isMessageDeletedLocally } from './deleted-messages';
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

/**
 * 等会话元信息的横幅候选(conversationId → 该会话最新一条)。
 *
 * 陌生人的第一条消息、刚被拉进的群:会话还不在快照里,标题/头像/跳转目标
 * 一个都拼不出来。原来的做法是从会话 id 的形状猜「这是不是 1:1」,猜中就用
 * 发送者信息凑一条 —— 而会话 id 其实是不透明 UUID,那条分支永远走不到,
 * 结果就是这两种情况**从来没有横幅**。改成先攒着,等补拉把元信息带回来再弹。
 */
const pendingBanners = new Map<string, ChatMessageDto>();
/** 攒的是会话数不是消息数;超了丢最早的会话,免得离线洪泛把它撑成内存泄漏。 */
const PENDING_BANNER_CONVERSATIONS_MAX = 20;

function rememberPendingBanner(message: ChatMessageDto): void {
  // 同一会话只留最新一条:补拉回来弹一条「有新消息」就够,
  // 不该把窗口期内攒的每一条都排进横幅队列。
  pendingBanners.delete(message.conversationId);
  pendingBanners.set(message.conversationId, message);
  while (pendingBanners.size > PENDING_BANNER_CONVERSATIONS_MAX) {
    const oldest = pendingBanners.keys().next().value;
    if (oldest === undefined) break;
    pendingBanners.delete(oldest);
  }
}

function flushPendingBanners(): void {
  const pending = Array.from(pendingBanners.values());
  pendingBanners.clear();
  for (const message of pending) {
    // 补拉后仍然认不出会话(已退群/已删好友/后端没返回)就放弃这一条:
    // 继续攒下去只会无限期占着,而它的元信息永远不会来了。
    enqueueForegroundBanner(message);
  }
}

function scheduleConversationBackfill(isLive: () => boolean): void {
  if (backfillTimer !== null) return;
  backfillTimer = setTimeout(() => {
    backfillTimer = null;
    if (!isLive()) {
      pendingBanners.clear();
      return;
    }
    void loadChatConversations()
      .then(() => {
        if (isLive()) flushPendingBanners();
      })
      .catch((err: unknown) => {
        console.warn('[chat] conversation backfill failed', err);
        // 元信息没拿到,攒着的候选也就没法变成正确的横幅了。
        pendingBanners.clear();
      });
  }, CONVERSATION_BACKFILL_DEBOUNCE_MS);
}

/** 测试与登出用:丢掉在途的补拉计时器与攒着的横幅。 */
export function cancelConversationBackfill(): void {
  pendingBanners.clear();
  if (backfillTimer === null) return;
  clearTimeout(backfillTimer);
  backfillTimer = null;
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
        return;
      }
      // 本端删过的消息重复投递时,整条都要在这里丢掉。
      // 只靠 store 里的过滤是不够的:applyIncomingMessage 对墓碑消息返回
      // 「已处理」,而下面的横幅与补拉是无条件跑的 —— 用户离开会话后,
      // 一条自己刚删掉的消息会以前台通知的形式重新弹出来。
      if (isMessageDeletedLocally(payload.id, payload.d)) return;

      const store = useChatStore.getState();
      // 顺序要紧:先联动会话列表再入时间线。applyIncomingMessage 靠
      // 「这条消息是否已在时间线里」判重复投递,先 ingest 的话它每次都会
      // 看到自己、未读永远加不上。
      const applied = store.applyIncomingMessage(payload);
      store.ingestMessages(payload.conversationId, [payload]);
      if (enqueueForegroundBanner(payload) === 'needs-conversation') {
        rememberPendingBanner(payload);
      }
      if (!applied) {
        // 会话不在当前快照里(对方刚建的单聊、刚被拉进的群):消息已经进了
        // 时间线,但没有会话行也没有角标 —— 停在消息页的用户要手动刷新才看得到。
        // 补拉一次会话列表把元信息(对端/群名/头像)带回来。
        scheduleConversationBackfill(isLive);
      }
    } catch (err) {
      console.warn('[chat] message handler failed', err);
    }
  });

  socket.on(CHAT_EVENTS.read, (payload: ChatReadBroadcast) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        typeof payload.userId !== 'string' ||
        typeof payload.height !== 'number'
      ) {
        console.warn('[chat] dropped malformed read payload');
        return;
      }
      useChatStore
        .getState()
        .applyRead(payload.conversationId, payload.userId, payload.height);
    } catch (err) {
      console.warn('[chat] read handler failed', err);
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
        return;
      }
      useChatStore.getState().applyPresence(payload.userId, payload.online);
    } catch (err) {
      console.warn('[chat] presence handler failed', err);
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

  const isGroup = conversation.type === 'GROUP';
  const title = isGroup
    ? (conversation.circle?.name ?? '')
    : (conversation.peer?.nickname ?? message.sender?.nickname ?? '');
  const avatarRaw = isGroup
    ? (conversation.circle?.avatarUrl ?? null)
    : (conversation.peer?.avatarUrl ?? null);
  const sourceID = isGroup
    ? (conversation.circleId ?? '')
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
