/**
 * im/listeners.ts — OpenIM SDK 全局事件监听器
 *
 * 由 client.ts 在 initSDK 成功后调用 bindOpenIMListeners() 完成绑定，
 * 不在 React 层 useEffect 里绑定 —— 因为部分 native 事件会在 initSDK
 * 即将完成时立刻触发，useEffect 的延迟挂载会让 JS 端错过它们。
 *
 * 监听器与 client.ts 之间不互相 import（防止循环依赖）：
 * - 收到新消息时直接通过 SDK 拉一次活动会话的最新历史，避免再回调 client。
 * - 连接成功时直接调 OpenIMSDK.getConversationListSplit。
 */
import OpenIMSDK, {
  SessionType,
  type ConversationItem,
  type MessageItem,
} from '@openim/rn-client-sdk';
import { router } from 'expo-router';
import { clearLocalSession } from '@/services/auth/session';
import { useIMStore } from '@/stores/imStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

let unbindAll: (() => void) | null = null;

function isMessageForActiveConversation(
  message: MessageItem,
  active: { sourceID: string; sessionType: SessionType },
  currentUserID: string | null,
) {
  if (active.sessionType === SessionType.Group) {
    return message.groupID === active.sourceID;
  }

  const peerID =
    message.sendID === currentUserID ? message.recvID : message.sendID;
  return (
    message.sessionType === SessionType.Single && peerID === active.sourceID
  );
}

export function bindOpenIMListeners() {
  if (unbindAll) {
    return unbindAll;
  }

  const handleConnecting = () => {
    useIMStore.getState().setConnecting(true);
    useIMStore.getState().setConnected(false);
    useIMStore.getState().setError(null);
  };
  OpenIMSDK.on('onConnecting', handleConnecting);

  const handleConnected = async () => {
    useIMStore.getState().setConnecting(false);
    useIMStore.getState().setConnected(true);
    useIMStore.getState().setError(null);

    try {
      const conversations = await OpenIMSDK.getConversationListSplit({
        offset: 0,
        count: 100,
      });
      useIMStore.getState().setConversations(conversations);
    } catch (error) {
      useIMStore
        .getState()
        .setError(error instanceof Error ? error.message : '拉取会话列表失败');
    }
  };
  OpenIMSDK.on('onConnectSuccess', handleConnected);

  const handleConnectFailed = (error: { errMsg?: string }) => {
    useIMStore.getState().setConnecting(false);
    useIMStore.getState().setConnected(false);
    useIMStore.getState().setError(error?.errMsg ?? 'OpenIM 连接失败');
  };
  OpenIMSDK.on('onConnectFailed', handleConnectFailed);

  const handleTokenExpired = async () => {
    useIMStore.getState().setConnected(false);
    useIMStore.getState().setError('登录已过期，请重新登录');
    await clearLocalSession();
    router.replace('/(auth)/login');
  };
  OpenIMSDK.on('onUserTokenExpired', handleTokenExpired);
  // SDK 也可能发 onUserTokenInvalid（token 不被服务器接受），统一按 expired 处理
  OpenIMSDK.on('onUserTokenInvalid', handleTokenExpired);

  const handleConversationChanged = (conversations: ConversationItem[]) => {
    useIMStore.getState().mergeConversations(conversations);
  };
  OpenIMSDK.on('onConversationChanged', handleConversationChanged);

  const handleNewConversation = (conversations: ConversationItem[]) => {
    useIMStore.getState().mergeConversations(conversations);
  };
  OpenIMSDK.on('onNewConversation', handleNewConversation);

  const handleUnreadChanged = (totalUnread: number) => {
    useIMStore.getState().setTotalUnread(totalUnread);
    useTabBadgeStore.getState().setMessagesUnread(totalUnread);
  };
  OpenIMSDK.on('onTotalUnreadMessageCountChanged', handleUnreadChanged);

  const handleNewMessages = (messages: MessageItem[]) => {
    const { activeConversation, currentUserID, appendMessages } =
      useIMStore.getState();

    if (!activeConversation) return;

    const matched = messages.filter((message) =>
      isMessageForActiveConversation(message, activeConversation, currentUserID),
    );

    if (matched.length > 0) {
      appendMessages(activeConversation.conversationID, matched);
    }
  };
  OpenIMSDK.on('onRecvNewMessages', handleNewMessages);

  unbindAll = () => {
    OpenIMSDK.off('onConnecting', handleConnecting);
    OpenIMSDK.off('onConnectSuccess', handleConnected);
    OpenIMSDK.off('onConnectFailed', handleConnectFailed);
    OpenIMSDK.off('onUserTokenExpired', handleTokenExpired);
    OpenIMSDK.off('onUserTokenInvalid', handleTokenExpired);
    OpenIMSDK.off('onConversationChanged', handleConversationChanged);
    OpenIMSDK.off('onNewConversation', handleNewConversation);
    OpenIMSDK.off('onTotalUnreadMessageCountChanged', handleUnreadChanged);
    OpenIMSDK.off('onRecvNewMessages', handleNewMessages);
    unbindAll = null;
  };

  return unbindAll;
}
