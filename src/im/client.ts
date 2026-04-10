/**
 * im/client.ts — OpenIM SDK 操作封装层
 *
 * 负责：
 * - SDK 单例初始化（ensureOpenIMInitialized）
 * - 用户登录 / 登出 OpenIM
 * - 拉取会话列表、历史消息
 * - 发送文字消息
 * - 判断某条消息是否属于当前会话（isMessageForConversation）
 *
 * 设计原则：
 * - SDK 只初始化一次（initPromise 单例），并发调用会等待同一个 Promise
 * - 登出时清空 initPromise，确保下次登录能重新初始化
 * - 所有 IM 状态写入 useIMStore，UI 层通过 store 订阅变化
 */
import OpenIMSDK, {
  LogLevel,
  SessionType,
  ViewType,
  type ConversationItem,
  type MessageItem,
} from '@openim/rn-client-sdk';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import {
  OPENIM_API_URL,
  OPENIM_LOG_LEVEL,
  OPENIM_WS_URL,
} from '@/constants/config';
import { useIMStore } from '@/stores/imStore';

// SDK 初始化 Promise 单例：避免并发重复 initSDK，登出后置为 null 允许重新初始化
let initPromise: Promise<void> | null = null;

function isNativeIMSupported() {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function getOpenIMDataDir() {
  return `${RNFS.DocumentDirectoryPath}/openim`;
}

function getPlatformID() {
  return Platform.OS === 'ios' ? 1 : 2;
}

function getUnsupportedPlatformMessage() {
  return 'OpenIM 仅支持 iOS/Android development build';
}

async function waitForOpenIMConnectionReady(timeoutMs = 5000, intervalMs = 50) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (useIMStore.getState().connected) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('IM 连接尚未完成，请稍后重试');
}

/**
 * 确保 OpenIM SDK 已初始化，只初始化一次。
 * 非 iOS/Android 平台直接返回 false，不抛错。
 * 初始化失败时重置 initPromise，允许下次重试。
 */
export async function ensureOpenIMInitialized() {
  if (!isNativeIMSupported()) {
    useIMStore.getState().setError(getUnsupportedPlatformMessage());
    return false;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const dataDir = getOpenIMDataDir();

      await RNFS.mkdir(dataDir);

      await OpenIMSDK.initSDK({
        apiAddr: OPENIM_API_URL,
        wsAddr: OPENIM_WS_URL,
        dataDir,
        logFilePath: dataDir,
        logLevel: OPENIM_LOG_LEVEL as LogLevel,
        isLogStandardOutput: true,
      });

      useIMStore.getState().setInitialized(true);
      useIMStore.getState().setError(null);
    })().catch((error) => {
      // 初始化失败时清空 Promise，允许下次重新尝试初始化
      initPromise = null;
      useIMStore.getState().setInitialized(false);
      useIMStore
        .getState()
        .setError(error instanceof Error ? error.message : 'OpenIM 初始化失败');
      throw error;
    });
  }

  await initPromise;

  return true;
}

/**
 * 登录 OpenIM。
 * 登录前先确保 SDK 已初始化；失败时重置 connecting 状态，防止 store 卡死。
 */
export async function loginToOpenIM(userID: string, imToken: string) {
  if (!imToken || !isNativeIMSupported()) {
    if (!isNativeIMSupported()) {
      useIMStore.getState().setError(getUnsupportedPlatformMessage());
    }
    return false;
  }

  try {
    await ensureOpenIMInitialized();
    useIMStore.getState().setCurrentUserID(userID);
    useIMStore.getState().setConnecting(true);
    useIMStore.getState().setError(null);

    await OpenIMSDK.login({
      userID,
      token: imToken,
    });

    return true;
  } catch (error) {
    // 登录失败时重置 connecting，防止 store 永久卡在"连接中"状态
    useIMStore.getState().setConnecting(false);
    throw error;
  }
}

/**
 * 登出 OpenIM，并重置所有 IM 状态。
 * 无论 SDK logout 是否成功都会清空本地状态。
 * 登出后清空 initPromise，下次登录时会重新执行 initSDK。
 */
export async function logoutFromOpenIM() {
  if (!isNativeIMSupported() || !initPromise) {
    useIMStore.getState().reset();
    return;
  }

  try {
    await OpenIMSDK.logout();
  } catch {
    // 忽略 SDK 登出失败，始终清空本地状态
  } finally {
    // 清空 initPromise，确保下次登录能重新执行 initSDK
    initPromise = null;
    useIMStore.getState().reset();
  }
}

export async function loadConversationList(count = 100) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    useIMStore.getState().setConversations([]);
    return [];
  }

  const conversations = await OpenIMSDK.getConversationListSplit({
    offset: 0,
    count,
  });

  useIMStore.getState().setConversations(conversations);

  return conversations;
}

export async function getOrCreateSingleConversation(sourceID: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const conversation = await OpenIMSDK.getOneConversation({
    sourceID,
    sessionType: SessionType.Single,
  });

  useIMStore.getState().mergeConversations([conversation]);

  return conversation;
}

export async function markConversationAsRead(conversationID: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    return;
  }

  await OpenIMSDK.markConversationMessageAsRead(conversationID);
}

export async function loadConversationMessages(
  conversationID: string,
  count = 50
) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    useIMStore.getState().setMessages(conversationID, []);
    return [];
  }

  const result = await OpenIMSDK.getAdvancedHistoryMessageList({
    conversationID,
    count,
    startClientMsgID: '',
    viewType: ViewType.History,
  });

  useIMStore.getState().setMessages(conversationID, result.messageList);

  return result.messageList;
}

export async function sendTextMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  text: string;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  const message = await OpenIMSDK.createTextMessage(params.text);
  const sentMessage = await OpenIMSDK.sendMessage({
    recvID: params.sessionType === SessionType.Single ? params.sourceID : '',
    groupID: params.sessionType === SessionType.Group ? params.sourceID : '',
    message,
    offlinePushInfo: {
      title: '新消息',
      desc: params.text,
      ex: '',
      iOSPushSound: 'default',
      iOSBadgeCount: true,
    },
  });

  return sentMessage;
}

export function isMessageForConversation(
  message: MessageItem,
  conversation: { sourceID: string; sessionType: SessionType },
  currentUserID: string | null
) {
  if (conversation.sessionType === SessionType.Group) {
    return message.groupID === conversation.sourceID;
  }

  const peerID = message.sendID === currentUserID ? message.recvID : message.sendID;
  return message.sessionType === SessionType.Single && peerID === conversation.sourceID;
}

export type { ConversationItem, MessageItem };
