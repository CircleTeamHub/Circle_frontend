import type { Socket } from 'socket.io-client';
import {
  CHAT_EVENTS,
  type ChatMessageDto,
  type ChatPresenceBroadcast,
  type ChatReadBroadcast,
} from './protocol';
import { useChatStore } from './store';

/**
 * 服务端事件 → store 的分发层（squady RealtimeEventDispatcher 的移植）。
 * 每个处理器独立 try/catch：单条畸形载荷只丢弃自身，
 * 不能让异常传回 socket.io 事件循环拖垮连接。
 *
 * isLive: session generation 检查 —— 登出后到达的事件一律丢弃，
 * 防止上一个账号的在途数据写进下一个账号的 store。
 */
export function bindChatEvents(socket: Socket, isLive: () => boolean): void {
  socket.on(CHAT_EVENTS.message, (payload: ChatMessageDto) => {
    if (!isLive()) return;
    try {
      if (
        !payload ||
        typeof payload.id !== 'string' ||
        typeof payload.conversationId !== 'string'
      ) {
        console.warn('[chat] dropped malformed message payload');
        return;
      }
      const store = useChatStore.getState();
      store.ingestMessages(payload.conversationId, [payload]);
      // 会话列表联动:末条前移 + 未读累计 + 重排序。
      store.applyIncomingMessage(payload);
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
