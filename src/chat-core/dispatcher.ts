import type { Socket } from 'socket.io-client';
import {
  CHAT_EVENTS,
  isChatMessageDto,
  isDirectConversationId,
  type ChatMessageDto,
  type ChatPresenceBroadcast,
  type ChatReadBroadcast,
} from './protocol';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
import { allowPeerMediaUrl } from '@/services/api/utils';
import { loadChatConversations } from './api';
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

function scheduleConversationBackfill(isLive: () => boolean): void {
  if (backfillTimer !== null) return;
  backfillTimer = setTimeout(() => {
    backfillTimer = null;
    if (!isLive()) return;
    void loadChatConversations().catch((err: unknown) => {
      console.warn('[chat] conversation backfill failed', err);
    });
  }, CONVERSATION_BACKFILL_DEBOUNCE_MS);
}

/** 测试与登出用:丢掉在途的补拉计时器。 */
export function cancelConversationBackfill(): void {
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
      const store = useChatStore.getState();
      // 顺序要紧:先联动会话列表再入时间线。applyIncomingMessage 靠
      // 「这条消息是否已在时间线里」判重复投递,先 ingest 的话它每次都会
      // 看到自己、未读永远加不上。
      const applied = store.applyIncomingMessage(payload);
      store.ingestMessages(payload.conversationId, [payload]);
      enqueueForegroundBanner(payload);
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
 */
function enqueueForegroundBanner(message: ChatMessageDto): void {
  const store = useChatStore.getState();
  const selfId = store.currentUserId;
  if (selfId !== null && message.sender?.id === selfId) return;
  if (store.activeConversationId === message.conversationId) return;
  if (message.type === 'system') return;

  const conversation = store.conversations.find(
    (c) => c.id === message.conversationId,
  );

  let title: string;
  let avatarRaw: string | null;
  let sourceID: string;
  let isGroup: boolean;

  if (conversation) {
    isGroup = conversation.type === 'GROUP';
    title = isGroup
      ? (conversation.circle?.name ?? '')
      : (conversation.peer?.nickname ?? message.sender?.nickname ?? '');
    avatarRaw = isGroup
      ? (conversation.circle?.avatarUrl ?? null)
      : (conversation.peer?.avatarUrl ?? null);
    sourceID = isGroup
      ? (conversation.circleId ?? '')
      : (conversation.peer?.id ?? '');
  } else if (isDirectConversationId(message.conversationId)) {
    // 陌生人的第一条消息:会话还不在快照里,补拉要等 800ms 防抖 + 一次请求,
    // 而横幅错过这一下就再也不会补。1:1 会话的发送者就是对端(自己发的上面
    // 已经挡掉),标题、头像、跳转要的 sourceID 消息里全都有,不必等。
    isGroup = false;
    title = message.sender?.nickname ?? '';
    avatarRaw = message.sender?.avatarUrl ?? null;
    sourceID = message.sender?.id ?? '';
  } else {
    // 群会话没有这条退路:标题要圈子名、跳转要圈子 id,消息里一个都没有。
    // 拿发送者去凑会弹出一个错的标题,点进去还进错房间 —— 不如不弹。
    return;
  }

  if (!title || !sourceID) return;
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
}
