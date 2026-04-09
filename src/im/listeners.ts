/**
 * im/listeners.ts — OpenIM SDK 全局事件监听器
 *
 * 统一注册以下事件：
 * - onConnecting / onConnectSuccess / onConnectFailed：连接状态变化
 * - onUserTokenExpired：token 过期
 * - onConversationChanged / onNewConversation：会话列表变更（增量合并）
 * - onTotalUnreadMessageCountChanged：全局未读数更新
 * - onRecvNewMessages：收到新消息，追加到当前活跃会话
 *
 * bindOpenIMListeners() 保证全局只绑定一次（unbindAll 单例）。
 * 返回 unbindAll 函数，调用方在组件卸载时负责解绑。
 */
import OpenIMSDK, { type ConversationItem, type MessageItem } from '@openim/rn-client-sdk';
import { router } from 'expo-router';
import { loadConversationList, isMessageForConversation } from '@/im/client';
import { clearLocalSession } from '@/services/auth/session';
import { useIMStore } from '@/stores/imStore';

// 模块级单例，确保全局只注册一套监听器；解绑后置为 null 允许重新绑定
let unbindAll: (() => void) | null = null;

export function bindOpenIMListeners() {
  // 已绑定过则直接返回现有的 unbind 函数，防止重复注册
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
      await loadConversationList();
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
  };
  OpenIMSDK.on('onTotalUnreadMessageCountChanged', handleUnreadChanged);

  const handleNewMessages = (messages: MessageItem[]) => {
    const {
      activeConversation,
      currentUserID,
      appendMessages,
    } = useIMStore.getState();

    // 只追加属于当前打开会话的消息，其他会话的新消息由 onConversationChanged 更新预览
    if (activeConversation) {
      const matchedMessages = messages.filter((message) =>
        isMessageForConversation(message, activeConversation, currentUserID)
      );

      if (matchedMessages.length > 0) {
        appendMessages(activeConversation.conversationID, matchedMessages);
      }
    }
    // 注意：不在此处调用 loadConversationList()，
    // 会话列表的更新由 onConversationChanged 事件负责，避免每条消息都触发全量拉取
  };
  OpenIMSDK.on('onRecvNewMessages', handleNewMessages);

  unbindAll = () => {
    OpenIMSDK.off('onConnecting', handleConnecting);
    OpenIMSDK.off('onConnectSuccess', handleConnected);
    OpenIMSDK.off('onConnectFailed', handleConnectFailed);
    OpenIMSDK.off('onUserTokenExpired', handleTokenExpired);
    OpenIMSDK.off('onConversationChanged', handleConversationChanged);
    OpenIMSDK.off('onNewConversation', handleNewConversation);
    OpenIMSDK.off('onTotalUnreadMessageCountChanged', handleUnreadChanged);
    OpenIMSDK.off('onRecvNewMessages', handleNewMessages);
    unbindAll = null;
  };

  return unbindAll;
}
