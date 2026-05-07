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
  GroupType,
  LogLevel,
  LoginStatus,
  MessageType,
  SessionType,
  ViewType,
  type GroupItem,
  type SearchMessageResult,
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
import { bindOpenIMListeners } from '@/im/listeners';
import { registerLogoutHandler } from '@/services/auth/session';
import { useIMStore } from '@/stores/imStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

// SDK 初始化 Promise 单例：避免并发重复 initSDK，登出后置为 null 允许重新初始化
let initPromise: Promise<void> | null = null;

// 注册到 session 的登出 teardown，由 clearLocalSession 统一调度。
// 函数声明会被 hoisting，所以这里在模块顶层引用 logoutFromOpenIM 是安全的。
registerLogoutHandler(() => logoutFromOpenIM());

/**
 * OpenIM v3.8 拒绝带连字符的 userID（PostgreSQL UUID 直接传会被判定非法）。
 * 把所有 user-id 形入参在跨过 SDK 边界前去掉连字符；后端发来的 imToken
 * 也是基于同一规则签发的，前后端必须一致。
 */
export function toImUserId(userId: string): string {
  return userId.replace(/-/g, '');
}

/**
 * 反向：把去连字符的 IM userID 还原成 PostgreSQL UUID 形式。
 * 已经是 UUID 格式的字符串原样返回，避免重复加连字符。
 */
export function fromImUserId(userId: string): string {
  // UUID 8-4-4-4-12，总长 36，含 4 个连字符
  if (userId.includes('-')) return userId;
  if (userId.length !== 32) return userId; // 不是 hex32 也不知道怎么改，原样返回
  return [
    userId.slice(0, 8),
    userId.slice(8, 12),
    userId.slice(12, 16),
    userId.slice(16, 20),
    userId.slice(20),
  ].join('-');
}

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

      // 在 initSDK 之前先绑定 listeners —— 否则 onConnecting / onConnectSuccess
      // 在 initSDK 内部即将触发时 JS 层还没挂回调，会被 native 直接丢成
      // "Sending xxx with no listeners registered" 警告，导致 connected 永远是 false。
      bindOpenIMListeners();

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
    const imUserID = toImUserId(userID);
    useIMStore.getState().setCurrentUserID(imUserID);
    useIMStore.getState().setError(null);

    // Hot reload 后 native SDK 进程通常还活着，重复 login 会被 OpenIM 拒成
    // 10102 "User has logged in repeatedly"。先查状态，已登录就直接复用，
    // 跳过 login 调用并把 connecting 置回 false。
    const status = await OpenIMSDK.getLoginStatus().catch(() => LoginStatus.Logout);
    if (status === LoginStatus.Logged) {
      useIMStore.getState().setConnecting(false);
      useIMStore.getState().setConnected(true);
      return true;
    }

    useIMStore.getState().setConnecting(true);
    await OpenIMSDK.login({
      userID: imUserID,
      token: imToken,
    });

    return true;
  } catch (error) {
    // 10102 = 重复登录。代表 native SDK 已经持有有效会话（hot reload 常见），
    // 直接当作登录成功，避免 SessionBootstrap 把它当真正的失败丢出来。
    const code = (error as { code?: number })?.code;
    const msg =
      error instanceof Error ? error.message : String(error ?? '');
    if (code === 10102 || msg.includes('User has logged in repeatedly')) {
      useIMStore.getState().setConnecting(false);
      useIMStore.getState().setConnected(true);
      return true;
    }
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
    sourceID: toImUserId(sourceID),
    sessionType: SessionType.Single,
  });

  useIMStore.getState().mergeConversations([conversation]);

  return conversation;
}

export async function getOrCreateGroupConversation(groupID: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const conversation = await OpenIMSDK.getOneConversation({
    sourceID: groupID,
    sessionType: SessionType.Group,
  });

  useIMStore.getState().mergeConversations([conversation]);

  return conversation;
}

/**
 * 新建群聊。memberUserIDs 必须是去连字符的 IM userID（同 toImUserId 的输出）。
 * 创建者默认成为群主，无需在 memberUserIDs 中重复。
 * 创建成功后刷新会话列表，便于上层立刻拿到新会话。
 */
export async function createGroupChat(params: {
  groupName: string;
  faceURL?: string;
  memberUserIDs: string[];
}): Promise<GroupItem> {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const group = await OpenIMSDK.createGroup({
    memberUserIDs: params.memberUserIDs,
    groupInfo: {
      groupName: params.groupName,
      faceURL: params.faceURL ?? '',
      groupType: GroupType.Group,
    },
  });

  await loadConversationList().catch(() => {
    // 创建成功但拉会话列表失败时静默忽略，UI 自己再触发重试
  });

  return group;
}

/**
 * 订阅一组用户的在线状态。OpenIM 会立刻在 Promise 里返回当前快照，
 * 之后通过 onUserStatusChanged 推送增量。userIDs 必须是去连字符的 IM 形式。
 */
export async function subscribeUserOnlineStatus(userIDs: string[]) {
  if (userIDs.length === 0) return;
  const initialized = await ensureOpenIMInitialized();
  if (!initialized) return;
  const snapshot = await OpenIMSDK.subscribeUsersStatus(userIDs);
  if (Array.isArray(snapshot) && snapshot.length > 0) {
    useIMStore.getState().setUserOnlineStatuses(
      snapshot.map((item) => ({ userID: item.userID, status: item.status })),
    );
  }
}

export async function unsubscribeUserOnlineStatus(userIDs: string[]) {
  if (userIDs.length === 0) return;
  const initialized = await ensureOpenIMInitialized();
  if (!initialized) return;
  await OpenIMSDK.unsubscribeUsersStatus(userIDs);
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
  const isSingle = params.sessionType === SessionType.Single;
  const sentMessage = await OpenIMSDK.sendMessage({
    recvID: isSingle ? toImUserId(params.sourceID) : '',
    groupID: !isSingle ? params.sourceID : '',
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

export async function sendImageMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  url: string;
  /**
   * 本地文件路径（ImagePicker 给的 asset.uri），SDK 会拿它算 hash 做缓存。
   * 传空串会让 native 端 open("") 报 "no such file or directory"。
   */
  sourcePath: string;
  width?: number;
  height?: number;
  size?: number;
  mimeType?: string;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  const picBase = {
    uuid: '',
    type: params.mimeType ?? 'image/jpeg',
    size: params.size ?? 0,
    width: params.width ?? 0,
    height: params.height ?? 0,
    url: params.url,
  };
  // SDK 需要本地路径不带 file:// 前缀
  const localPath = params.sourcePath.replace(/^file:\/\//, '');
  const message = await OpenIMSDK.createImageMessageByURL({
    sourcePicture: picBase,
    bigPicture: picBase,
    snapshotPicture: picBase,
    sourcePath: localPath,
  });

  const isSingle = params.sessionType === SessionType.Single;
  return OpenIMSDK.sendMessage({
    recvID: isSingle ? toImUserId(params.sourceID) : '',
    groupID: !isSingle ? params.sourceID : '',
    message,
    offlinePushInfo: {
      title: '新消息',
      desc: '[图片]',
      ex: '',
      iOSPushSound: 'default',
      iOSBadgeCount: true,
    },
  });
}

export async function sendLocationMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  longitude: number;
  latitude: number;
  description: string;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  const message = await OpenIMSDK.createLocationMessage({
    description: params.description,
    longitude: params.longitude,
    latitude: params.latitude,
  });

  const isSingle = params.sessionType === SessionType.Single;
  return OpenIMSDK.sendMessage({
    recvID: isSingle ? toImUserId(params.sourceID) : '',
    groupID: !isSingle ? params.sourceID : '',
    message,
    offlinePushInfo: {
      title: '新消息',
      desc: '[位置]',
      ex: '',
      iOSPushSound: 'default',
      iOSBadgeCount: true,
    },
  });
}

/**
 * Custom-message extension key marking our note-card payload.
 * Receivers (and senders, on echo) decode this to render a rich note bubble.
 */
export const NOTE_CARD_EXTENSION = 'note-card-v1';

/** Same idea for the points-transfer card. Payload is `TransferCardData`. */
export const TRANSFER_CARD_EXTENSION = 'transfer-card-v1';

export interface TransferCardPayload {
  amount: number;
  message: string | null;
}

export async function sendTransferCardMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  payload: TransferCardPayload;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  const { amount } = params.payload;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('转账金额无效');
  }

  const preview = `[转账] ${amount} 积分`;
  const message = await OpenIMSDK.createCustomMessage({
    data: JSON.stringify(params.payload),
    extension: TRANSFER_CARD_EXTENSION,
    description: preview,
  });

  const isSingle = params.sessionType === SessionType.Single;
  return OpenIMSDK.sendMessage({
    recvID: isSingle ? toImUserId(params.sourceID) : '',
    groupID: !isSingle ? params.sourceID : '',
    message,
    offlinePushInfo: {
      title: '新消息',
      desc: preview,
      ex: '',
      iOSPushSound: 'default',
      iOSBadgeCount: true,
    },
  });
}

export interface NoteCardPayload {
  noteId: string;
  title: string;
  contentPreview: string | null;
  coverUrl: string | null;
  imageCount: number;
  videoCount: number;
  groupNames: string[];
}

export async function sendNoteCardMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  payload: NoteCardPayload;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  const message = await OpenIMSDK.createCustomMessage({
    data: JSON.stringify(params.payload),
    extension: NOTE_CARD_EXTENSION,
    description: `[笔记] ${params.payload.title}`,
  });

  const isSingle = params.sessionType === SessionType.Single;
  return OpenIMSDK.sendMessage({
    recvID: isSingle ? toImUserId(params.sourceID) : '',
    groupID: !isSingle ? params.sourceID : '',
    message,
    offlinePushInfo: {
      title: '新消息',
      desc: `[笔记] ${params.payload.title}`,
      ex: '',
      iOSPushSound: 'default',
      iOSBadgeCount: true,
    },
  });
}

/**
 * Friend-card extension format stuffed into `cardElem.ex`. Lets the receiver
 * render persona / displayIcons even though OpenIM's card schema only carries
 * userID / nickname / faceURL natively.
 */
export const FRIEND_CARD_EXT_VERSION = 'friend-card-v1';

interface FriendCardExt {
  v: typeof FRIEND_CARD_EXT_VERSION;
  persona: string | null;
  displayIcons: import('@/types').DisplayIcon[];
}

export async function sendFriendCardMessage(params: {
  targetConversationID: string;
  userID: string;
  nickname: string;
  faceURL: string;
  persona?: string | null;
  displayIcons?: import('@/types').DisplayIcon[];
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  const targetConversation = useIMStore
    .getState()
    .conversations.find(
      (conversation) => conversation.conversationID === params.targetConversationID,
    );

  if (!targetConversation) {
    throw new Error('目标会话不存在');
  }

  const ext: FriendCardExt = {
    v: FRIEND_CARD_EXT_VERSION,
    persona: params.persona ?? null,
    displayIcons: params.displayIcons ?? [],
  };
  const message = await OpenIMSDK.createCardMessage({
    // 名片里存业务侧 user.id（带连字符）—— 收件人点卡片要靠这个 ID
    // 去 circle_be 拉资料；这跟 IM 登录用的"去连字符 ID"是两件事。
    userID: params.userID,
    nickname: params.nickname,
    faceURL: params.faceURL,
    ex: JSON.stringify(ext),
  });
  const isGroupConversation =
    targetConversation.conversationType === SessionType.Group;

  return OpenIMSDK.sendMessage({
    recvID: isGroupConversation ? '' : targetConversation.userID,
    groupID: isGroupConversation ? targetConversation.groupID : '',
    message,
    offlinePushInfo: {
      title: '好友推荐',
      desc: params.nickname,
      ex: '',
      iOSPushSound: 'default',
      iOSBadgeCount: true,
    },
  });
}

export async function toggleConversationPinned(
  conversationID: string,
  isPinned: boolean
) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.pinConversation({ conversationID, isPinned });
}

export async function setConversationMute(
  conversationID: string,
  muted: boolean
) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.setConversationRecvMessageOpt({
    conversationID,
    opt: muted ? 2 : 0,
  });
}

export async function setConversationBurnDuration(
  conversationID: string,
  burnDuration: number
) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.setConversationBurnDuration({ conversationID, burnDuration });
}

export async function clearConversationMessages(conversationID: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.clearConversationAndDeleteAllMsg(conversationID);
  useIMStore.getState().setMessages(conversationID, []);
}

export async function clearAllLocalMessages() {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.deleteAllMsgFromLocal();
  useIMStore.getState().clearAllMessages();
  useTabBadgeStore.getState().setMessagesUnread(0);
  await loadConversationList();
}

function flattenSearchResult(result: SearchMessageResult) {
  const items = result.searchResultItems ?? result.findResultItems ?? [];
  return items.flatMap((item) => item.messageList);
}

async function searchConversationMessages(params: {
  conversationID: string;
  keywordList: string[];
  keywordListMatchType?: number;
  messageTypeList?: MessageType[];
  searchTimePosition?: number;
  searchTimePeriod?: number;
  pageIndex?: number;
  count?: number;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    return [];
  }

  const result = await OpenIMSDK.searchLocalMessages(params);
  return flattenSearchResult(result);
}

export async function searchConversationTextMessages(params: {
  conversationID: string;
  keyword: string;
  pageIndex?: number;
  count?: number;
}) {
  const keyword = params.keyword.trim();

  if (!keyword) {
    return [];
  }

  return searchConversationMessages({
    conversationID: params.conversationID,
    keywordList: [keyword],
    keywordListMatchType: 0,
    messageTypeList: [MessageType.TextMessage],
    pageIndex: params.pageIndex ?? 1,
    count: params.count ?? 20,
  });
}

export async function searchConversationMediaMessages(params: {
  conversationID: string;
  pageIndex?: number;
  count?: number;
}) {
  return searchConversationMessages({
    conversationID: params.conversationID,
    keywordList: [''],
    messageTypeList: [MessageType.PictureMessage, MessageType.VideoMessage],
    pageIndex: params.pageIndex ?? 1,
    count: params.count ?? 20,
  });
}

export async function searchConversationFileMessages(params: {
  conversationID: string;
  pageIndex?: number;
  count?: number;
}) {
  return searchConversationMessages({
    conversationID: params.conversationID,
    keywordList: [''],
    messageTypeList: [MessageType.FileMessage],
    pageIndex: params.pageIndex ?? 1,
    count: params.count ?? 20,
  });
}

export async function searchConversationMessagesByDate(params: {
  conversationID: string;
  date: string;
  pageIndex?: number;
  count?: number;
}) {
  const startOfDay = new Date(`${params.date}T00:00:00`).getTime();

  if (!Number.isFinite(startOfDay)) {
    return [];
  }

  return searchConversationMessages({
    conversationID: params.conversationID,
    keywordList: [''],
    searchTimePosition: startOfDay,
    searchTimePeriod: 24 * 60 * 60,
    pageIndex: params.pageIndex ?? 1,
    count: params.count ?? 50,
  });
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

export type { ConversationItem, GroupItem, MessageItem };
