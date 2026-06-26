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
  GroupMemberFilter,
  LogLevel,
  LoginStatus,
  MessageType,
  SessionType,
  ViewType,
  type GroupItem,
  type GroupMemberItem,
  type SearchMessageResult,
  type ConversationItem,
  type MessageItem,
} from '@openim/rn-client-sdk';
import type * as NativeFS from 'react-native-fs';
import { Platform } from 'react-native';
import {
  LIMITS,
  OPENIM_API_URL,
  OPENIM_LOG_LEVEL,
  OPENIM_WS_URL,
} from '@/constants/config';
import { bindOpenIMListeners } from '@/im/listeners';
import { stripFileScheme } from '@/im/media-uri';
import { resolveVoiceSendStrategy } from '@/features/chat/utils/voice-forward';
import { toImUserId } from '@/im/user-id';
import { registerLogoutHandler } from '@/services/auth/session';
import { useIMStore } from '@/stores/imStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

export { fromImUserId, toImUserId } from '@/im/user-id';

// SDK 初始化 Promise 单例：避免并发重复 initSDK，登出后置为 null 允许重新初始化
let initPromise: Promise<void> | null = null;
type NativeFSModule = typeof NativeFS & { default?: typeof NativeFS };
let rnfsModule: typeof NativeFS | null = null;

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

// 注册到 session 的登出 teardown，由 clearLocalSession 统一调度。
// 函数声明会被 hoisting，所以这里在模块顶层引用 logoutFromOpenIM 是安全的。
// 直接传函数引用而不是包一层箭头：session.ts 按引用去重，箭头每次模块求值都是新引用，
// HMR 时会让同一个 teardown 累积多次（已经被 Batch 01 的 dedup 暴露过）。
registerLogoutHandler(logoutFromOpenIM);

function isNativeIMSupported() {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function loadNativeFS() {
  if (!rnfsModule) {
    // Keep react-native-fs out of non-native startup paths.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-fs') as NativeFSModule;
    rnfsModule = loaded.default ?? loaded;
  }

  return rnfsModule;
}

async function getOpenIMDataDir() {
  const RNFS = loadNativeFS();
  return `${RNFS.DocumentDirectoryPath}/openim`;
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
      const RNFS = loadNativeFS();
      const dataDir = await getOpenIMDataDir();

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
    // 登录失败时重置 connecting，并把 currentUserID 也清掉 —— 它在 L167 已经被乐观写入
    // 之后任何登录前的失败都会让 store 残留一个错误身份，影响 read-receipt 路由 / 气泡对齐。
    useIMStore.getState().setConnecting(false);
    useIMStore.getState().setCurrentUserID(null);
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

  // SDK 已初始化但未连接（登录还在进行 / 登录失败 / 已断开）时，没有可登出的会话，
  // 直接 OpenIMSDK.logout() 会报 10004「Resource initialization incomplete」。
  // 此时跳过 SDK logout、只清本地状态并重置 initPromise（下次登录会重新 initSDK）。
  if (!useIMStore.getState().connected) {
    initPromise = null;
    useIMStore.getState().reset();
    return;
  }

  try {
    await OpenIMSDK.logout();
  } catch (err) {
    // SDK 登出失败不阻断本地清理；dev 下打印出来，避免 native 端长期处于异常状态而没人发现。
    if (isDev) {
      console.warn('[openim] SDK logout failed (local state still reset)', err);
    }
  } finally {
    // 清空 initPromise，确保下次登录能重新执行 initSDK
    initPromise = null;
    useIMStore.getState().reset();
  }
}

export async function loadConversationList(count = 100) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    // 初始化失败（瞬时 native I/O 失败 / 平台不支持等）时保留 store 已缓存的会话，
    // 避免一次短暂错误把"曾经成功加载过的会话列表"清成空，让用户误以为没有任何对话。
    // 真正需要清空时由 logoutFromOpenIM → useIMStore.reset() 显式负责。
    return useIMStore.getState().conversations;
  }

  // SDK 初始化完成 ≠ 已登录就绪。新注册 / 刚登录时 loginToOpenIM 仍在进行中，
  // 此刻直接 getConversationListSplit 会报 10004「Resource initialization incomplete」。
  // 先等连接就绪再拉；等不到（超时）就返回已缓存会话，避免抛错刷屏并清空列表 ——
  // 连接成功后 onConnectSuccess 监听器也会自动重新拉一次，最终一致。
  try {
    await waitForOpenIMConnectionReady();
  } catch {
    return useIMStore.getState().conversations;
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

  await loadConversationList().catch((err) => {
    // 创建成功但拉会话列表失败时不阻断 —— UI 自己会再触发重试。
    // 但要在 dev 把错误暴露出来，否则群创建后立刻看不到新会话时无从查起。
    if (isDev) {
      console.warn('[openim] createGroupChat: loadConversationList failed', err);
    }
  });

  return group;
}

export async function getGroupInfo(groupID: string): Promise<GroupItem | null> {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    return null;
  }

  const groups = await OpenIMSDK.getSpecifiedGroupsInfo([groupID]);
  return groups[0] ?? null;
}

export async function loadGroupMemberList(
  groupID: string,
  count = 20
): Promise<GroupMemberItem[]> {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    return [];
  }

  return OpenIMSDK.getGroupMemberList({
    groupID,
    filter: GroupMemberFilter.All,
    offset: 0,
    count,
  });
}

export async function inviteUsersToGroup(groupID: string, userIDList: string[]) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.inviteUserToGroup({
    groupID,
    userIDList,
    reason: '',
  });
}

export async function leaveGroupChat(groupID: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.quitGroup(groupID);
  await loadConversationList().catch(() => {
    // 群退出成功后刷新会话列表；失败时让调用方继续回到上一页。
  });
}

export async function updateGroupName(groupID: string, groupName: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.setGroupInfo({ groupID, groupName });
  await loadConversationList().catch(() => {
    // 群资料已更新，列表刷新失败时等待 SDK 推送同步。
  });
}

export async function updateGroupNotice(groupID: string, notification: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.setGroupInfo({ groupID, notification });
}

export async function updateGroupMemberAlias(
  groupID: string,
  userID: string,
  nickname: string
) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.setGroupMemberInfo({ groupID, userID, nickname });
}

export async function kickGroupMembers(
  groupID: string,
  userIDList: string[],
  reason = ''
) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.kickGroupMember({ groupID, userIDList, reason });
}

export async function hideConversation(conversationID: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.hideConversation(conversationID);
  await loadConversationList().catch(() => {
    // 会话已折叠，列表刷新失败时等待 SDK 推送同步。
  });
}

export async function resetConversationGroupAtType(conversationID: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.resetConversationGroupAtType(conversationID);
  await loadConversationList().catch(() => {
    // 通知状态已重置，列表刷新失败时等待 SDK 推送同步。
  });
}

export async function setConversationExtension(
  conversationID: string,
  patch: Record<string, unknown>,
  currentExtension?: string
) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  let current: Record<string, unknown> = {};
  const resolvedExtension =
    currentExtension ??
    useIMStore
      .getState()
      .conversations.find((conversation) => conversation.conversationID === conversationID)
      ?.ex;

  if (resolvedExtension) {
    try {
      const parsed = JSON.parse(resolvedExtension) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        current = parsed as Record<string, unknown>;
      }
    } catch {
      current = {};
    }
  }

  await OpenIMSDK.setConversation({
    conversationID,
    ex: JSON.stringify({ ...current, ...patch }),
  });
  await loadConversationList().catch(() => {
    // 会话扩展已更新，列表刷新失败时等待 SDK 推送同步。
  });
}

/**
 * 拉当前用户加入的所有群聊。OpenIM SDK 已缓存群信息，调用一次成本不高，
 * GroupItem 已包含 groupName / faceURL / memberCount / ownerUserID 等所有渲染所需字段，
 * 不需要再 N+1 fetch 每个群的详情。
 */
export async function getJoinedGroups(): Promise<GroupItem[]> {
  const initialized = await ensureOpenIMInitialized();
  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }
  await waitForOpenIMConnectionReady();
  return OpenIMSDK.getJoinedGroupList();
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
  const messages = await readLocalConversationMessages(conversationID, count);

  useIMStore.getState().setMessages(conversationID, messages);

  return messages;
}

export async function readLocalConversationMessages(
  conversationID: string,
  count = 50
) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    return [];
  }

  const result = await OpenIMSDK.getAdvancedHistoryMessageList({
    conversationID,
    count,
    startClientMsgID: '',
    viewType: ViewType.History,
  });

  // setMessages 由上层 loadConversationMessages 包一层负责；这里保持纯读，
  // 历史恢复直接调本函数读本地、而不污染 store。
  if (isDev) {
    const first = result.messageList[0];
    const last = result.messageList[result.messageList.length - 1];
    console.info('[openim] readLocalConversationMessages result', {
      conversationID,
      count,
      returned: result.messageList.length,
      firstClientMsgID: first?.clientMsgID,
      lastClientMsgID: last?.clientMsgID,
      firstContentType: first?.contentType,
      lastContentType: last?.contentType,
    });
  }

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

  await waitForOpenIMConnectionReady();

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

  await waitForOpenIMConnectionReady();

  const picBase = {
    uuid: '',
    type: params.mimeType ?? 'image/jpeg',
    size: params.size ?? 0,
    width: params.width ?? 0,
    height: params.height ?? 0,
    url: params.url,
  };
  // SDK 需要本地路径不带 file:// 前缀（播放端用 toPlayableUri 还原 scheme）
  const localPath = stripFileScheme(params.sourcePath);
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

  await waitForOpenIMConnectionReady();

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

export async function sendVoiceMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  soundPath: string;
  duration: number;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  // SDK 需要本地路径不带 file:// 前缀（播放端用 toPlayableUri 还原 scheme）
  const localPath = stripFileScheme(params.soundPath);
  const duration = Math.max(1, Math.round(params.duration));
  const message = await OpenIMSDK.createSoundMessageFromFullPath({
    soundPath: localPath,
    duration,
  });

  const isSingle = params.sessionType === SessionType.Single;
  return OpenIMSDK.sendMessage({
    recvID: isSingle ? toImUserId(params.sourceID) : '',
    groupID: !isSingle ? params.sourceID : '',
    message,
    offlinePushInfo: {
      title: '新消息',
      desc: '[语音]',
      ex: '',
      iOSPushSound: 'default',
      iOSBadgeCount: true,
    },
  });
}

export async function sendVoiceMessageByUrl(params: {
  sourceID: string;
  sessionType: SessionType;
  sourceUrl: string;
  soundPath?: string;
  duration: number;
  dataSize?: number;
  soundType?: string;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const duration = Math.max(1, Math.round(params.duration));
  const message = await OpenIMSDK.createSoundMessageByURL({
    uuid: '',
    soundPath: params.soundPath ? stripFileScheme(params.soundPath) : '',
    sourceUrl: params.sourceUrl,
    dataSize: params.dataSize ?? 0,
    duration,
    soundType: params.soundType,
  });

  const isSingle = params.sessionType === SessionType.Single;
  return OpenIMSDK.sendMessage({
    recvID: isSingle ? toImUserId(params.sourceID) : '',
    groupID: !isSingle ? params.sourceID : '',
    message,
    offlinePushInfo: {
      title: '新消息',
      desc: '[语音]',
      ex: '',
      iOSPushSound: 'default',
      iOSBadgeCount: true,
    },
  });
}

/**
 * Re-send a voice message from whatever source we still have (remote url
 * preferred, local path as fallback). Single source of truth for the
 * "forward voice" and "send collected voice" flows.
 */
export async function sendVoiceMessageFromSource(params: {
  sourceID: string;
  sessionType: SessionType;
  sourceUrl?: string | null;
  soundPath?: string | null;
  duration: number;
  dataSize?: number;
}) {
  const strategy = resolveVoiceSendStrategy({
    sourceUrl: params.sourceUrl,
    soundPath: params.soundPath,
  });

  if (!strategy) {
    throw new Error('语音缺少可播放地址');
  }

  if (strategy.kind === 'url') {
    return sendVoiceMessageByUrl({
      sourceID: params.sourceID,
      sessionType: params.sessionType,
      sourceUrl: strategy.sourceUrl,
      soundPath: strategy.soundPath,
      duration: params.duration,
      dataSize: params.dataSize,
    });
  }

  return sendVoiceMessage({
    sourceID: params.sourceID,
    sessionType: params.sessionType,
    soundPath: strategy.soundPath,
    duration: params.duration,
  });
}

/**
 * Forward an existing OpenIM message to another conversation using the SDK's
 * native forward primitive. This preserves media (image / voice / video /
 * file) and custom payloads (note / friend / transfer cards) without
 * re-uploading or re-encoding — the correct path for "转发" of any type.
 */
export async function forwardMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  message: MessageItem;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const forwarded = await OpenIMSDK.createForwardMessage(params.message);

  const isSingle = params.sessionType === SessionType.Single;
  return OpenIMSDK.sendMessage({
    recvID: isSingle ? toImUserId(params.sourceID) : '',
    groupID: !isSingle ? params.sourceID : '',
    message: forwarded,
    offlinePushInfo: {
      title: '新消息',
      desc: '[消息]',
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

  await waitForOpenIMConnectionReady();

  const { amount } = params.payload;
  // 积分必须为正整数；上限拦截 off-by-orders / overflow 攻击。真实业务上限以后端为准。
  if (
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > LIMITS.TRANSFER_MAX_AMOUNT
  ) {
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
  ownerId?: string | null;
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

  await waitForOpenIMConnectionReady();

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

  await waitForOpenIMConnectionReady();

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

export const CIRCLE_CARD_EXT_VERSION = 'circle-card-v1';

interface CircleCardExt {
  v: typeof CIRCLE_CARD_EXT_VERSION;
  // Discriminator so mappers can tell a circle card apart from a friend card —
  // both ride OpenIM's native card message.
  kind: 'circle';
}

export async function sendCircleCardMessage(params: {
  targetConversationID: string;
  circleId: string;
  name: string;
  avatarUrl: string | null;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const targetConversation = useIMStore
    .getState()
    .conversations.find(
      (conversation) =>
        conversation.conversationID === params.targetConversationID,
    );

  if (!targetConversation) {
    throw new Error('目标会话不存在');
  }

  const ext: CircleCardExt = { v: CIRCLE_CARD_EXT_VERSION, kind: 'circle' };
  const message = await OpenIMSDK.createCardMessage({
    // 圈子 id 存在 card 的 userID 槽里 —— 收件人点名片靠它打开圈子详情。
    userID: params.circleId,
    nickname: params.name,
    faceURL: params.avatarUrl ?? '',
    ex: JSON.stringify(ext),
  });
  const isGroupConversation =
    targetConversation.conversationType === SessionType.Group;

  return OpenIMSDK.sendMessage({
    recvID: isGroupConversation ? '' : targetConversation.userID,
    groupID: isGroupConversation ? targetConversation.groupID : '',
    message,
    offlinePushInfo: {
      title: '圈子邀请',
      desc: params.name,
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

export async function deleteConversation(conversationID: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.deleteConversationAndDeleteAllMsg(conversationID);
  useIMStore.getState().setMessages(conversationID, []);
  await loadConversationList().catch(() => {
    // 会话已删除，列表刷新失败时等待 SDK 推送同步。
  });
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

function getChatHistoryDateMessageTypes() {
  return [
    MessageType.TextMessage,
    MessageType.PictureMessage,
    MessageType.VoiceMessage,
    MessageType.VideoMessage,
    MessageType.FileMessage,
    MessageType.LocationMessage,
    MessageType.CardMessage,
    MessageType.CustomMessage,
  ].filter((type): type is MessageType => typeof type === 'number');
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
    messageTypeList: getChatHistoryDateMessageTypes(),
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
