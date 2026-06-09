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
  type UserOnlineState,
} from '@openim/rn-client-sdk';
import { router } from 'expo-router';
import i18n from '@/i18n';
import { clearLocalSession } from '@/services/auth/session';
import { buildChatSnackbar } from '@/im/snackbar';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
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

function enqueueChatSnackbar(
  message: MessageItem,
  conversations: ConversationItem[],
  currentUserID: string | null,
) {
  const payload = buildChatSnackbar(
    message,
    conversations,
    currentUserID,
    message.sessionType === SessionType.Group,
    {
      title: i18n.t('chat.snackbarNewMessage'),
      preview: i18n.t('chat.snackbarPreviewFallback'),
    },
  );

  if (payload) {
    useNotificationSnackbarStore.getState().enqueueChatMessage(payload);
  }
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

  // onConversationChanged 与 onNewConversation 共享同一个 handler 引用：
  // 行为相同 + 共享 ref 便于 off 时一一对应、也少一份闭包。
  const handleConversationsBatched = (conversations: ConversationItem[]) => {
    useIMStore.getState().mergeConversations(conversations);
  };
  OpenIMSDK.on('onConversationChanged', handleConversationsBatched);
  OpenIMSDK.on('onNewConversation', handleConversationsBatched);

  const handleUnreadChanged = (totalUnread: number) => {
    useIMStore.getState().setTotalUnread(totalUnread);
    useTabBadgeStore.getState().setMessagesUnread(totalUnread);
  };
  OpenIMSDK.on('onTotalUnreadMessageCountChanged', handleUnreadChanged);

  // C2C 已读回执：对方阅读消息后，SDK 把读到的 clientMsgID 列表回推给发送方。
  // payload 形如 [{ userID, conversationID, msgIDList }, ...]，不同 SDK 版本字段
  // 命名略不同（msgIDList / clientMsgIDList / readMsgIDList），都兼容下。
  const handleC2CReadReceipt = (
    receipts: ReadonlyArray<{
      userID?: string;
      conversationID?: string;
      msgIDList?: string[];
      clientMsgIDList?: string[];
      readMsgIDList?: string[];
    }>,
  ) => {
    if (!Array.isArray(receipts)) return;
    const { conversations } = useIMStore.getState();
    for (const receipt of receipts) {
      const ids =
        receipt.msgIDList ??
        receipt.clientMsgIDList ??
        receipt.readMsgIDList ??
        [];
      if (ids.length === 0) continue;
      // 优先用 receipt 自带的 conversationID；否则按 userID 在已加载的会话里查。
      // 移除 activeConversation 兜底 —— 如果 receipt 既无 conversationID 又
      // 找不到匹配的 userID，盲目套到当前会话会把消息标到错的人头上。
      let conversationID = receipt.conversationID;
      if (!conversationID && receipt.userID) {
        const conv = conversations.find(
          (c) => c.userID === receipt.userID,
        );
        conversationID = conv?.conversationID;
      }
      if (!conversationID) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[openim] unrouted C2C read receipt — dropped', receipt);
        }
        continue;
      }
      useIMStore.getState().markMessagesRead(conversationID, ids);
    }
  };
  OpenIMSDK.on('onRecvC2CReadReceipt', handleC2CReadReceipt);

  const handleNewMessages = (messages: MessageItem[]) => {
    const { activeConversation, currentUserID, appendMessages, conversations } =
      useIMStore.getState();

    if (!activeConversation) {
      messages.forEach((message) =>
        enqueueChatSnackbar(message, conversations, currentUserID),
      );
      return;
    }

    const matched = messages.filter((message) =>
      isMessageForActiveConversation(message, activeConversation, currentUserID),
    );

    messages
      .filter(
        (message) =>
          !isMessageForActiveConversation(
            message,
            activeConversation,
            currentUserID,
          ),
      )
      .forEach((message) =>
        enqueueChatSnackbar(message, conversations, currentUserID),
      );

    if (matched.length > 0) {
      appendMessages(activeConversation.conversationID, matched);
    }
  };
  OpenIMSDK.on('onRecvNewMessages', handleNewMessages);

  // 订阅过的用户状态变化时 SDK 会回推一条记录，转写到 store。
  const handleUserStatusChanged = (status: UserOnlineState) => {
    if (!status?.userID) return;
    useIMStore
      .getState()
      .setUserOnlineStatuses([{ userID: status.userID, status: status.status }]);
  };
  OpenIMSDK.on('onUserStatusChanged', handleUserStatusChanged);

  unbindAll = () => {
    OpenIMSDK.off('onConnecting', handleConnecting);
    OpenIMSDK.off('onConnectSuccess', handleConnected);
    OpenIMSDK.off('onConnectFailed', handleConnectFailed);
    OpenIMSDK.off('onUserTokenExpired', handleTokenExpired);
    OpenIMSDK.off('onUserTokenInvalid', handleTokenExpired);
    OpenIMSDK.off('onConversationChanged', handleConversationsBatched);
    OpenIMSDK.off('onNewConversation', handleConversationsBatched);
    OpenIMSDK.off('onTotalUnreadMessageCountChanged', handleUnreadChanged);
    OpenIMSDK.off('onRecvNewMessages', handleNewMessages);
    OpenIMSDK.off('onRecvC2CReadReceipt', handleC2CReadReceipt);
    OpenIMSDK.off('onUserStatusChanged', handleUserStatusChanged);
    unbindAll = null;
  };

  return unbindAll;
}
