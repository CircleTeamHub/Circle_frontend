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
  type SearchMessageResultItem,
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
import { bindOpenIMListeners, unbindOpenIMListeners } from '@/im/listeners';
import {
  registerIMLoginExecutor,
  registerIMLogoutExecutor,
} from '@/im/token-recovery';
import { stripFileScheme } from '@/im/media-uri';
import { resolveVoiceSendStrategy } from '@/features/chat/utils/voice-forward';
import { toImUserId } from '@/im/user-id';
import { registerLogoutHandler } from '@/services/auth/session';
import { useIMStore } from '@/stores/imStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { reportError } from '@/observability/sentry';
import { assertLocalCanSendMessage } from '@/services/api/credit-policy';
import type { PlazaPostCardData } from '@/types';

export { fromImUserId, toImUserId } from '@/im/user-id';

// SDK 初始化 Promise 单例：避免并发重复 initSDK，登出后置为 null 允许重新初始化
let initPromise: Promise<void> | null = null;
// 「僵尸登录态」自愈开关：native SDK 自报 Logged 但资源已卸载时，unInitSDK 重建一次。
// 模块级 —— 每个 JS 生命周期（含每次 hot-reload）最多自愈一次，避免登录环路。
let staleLoginSelfHealAttempted = false;
let logoutPromise: Promise<void> | null = null;
type NativeFSModule = typeof NativeFS & { default?: typeof NativeFS };
let rnfsModule: typeof NativeFS | null = null;

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

// 所有发送变体最终都走 OpenIMSDK.sendMessage —— 在此统一上报发送失败（用户可见的
// 关键失败，类似上传），并原样抛出，不改各发送函数的行为。用 bracket 访问避免被批量
// 替换误伤。
async function reportSend(
  options: Parameters<typeof OpenIMSDK.sendMessage>[0],
): ReturnType<typeof OpenIMSDK.sendMessage> {
  assertLocalCanSendMessage();
  return OpenIMSDK['sendMessage'](options).catch((error: unknown) => {
    reportError(error, { operation: 'openim', kind: 'sendMessage' });
    throw error;
  });
}

// 注册到 session 的登出 teardown，由 clearLocalSession 统一调度。
// 函数声明会被 hoisting，所以这里在模块顶层引用 logoutFromOpenIM 是安全的。
// 直接传函数引用而不是包一层箭头：session.ts 按引用去重，箭头每次模块求值都是新引用，
// HMR 时会让同一个 teardown 累积多次（已经被 Batch 01 的 dedup 暴露过）。
registerLogoutHandler(logoutFromOpenIM);

// token-recovery 不 import 本模块（避免 client → listeners → token-recovery → client
// 模块环），真正的 OpenIM 登录函数在这里注入。同样按引用注册，幂等。
// 恢复路径必须强制真登录（review 修复 P1）：token 过期时 getLoginStatus 很可能
// 仍报 Logged，普通路径的复用快捷会让新 token 永远交不到 SDK 手里。
registerIMLoginExecutor((userId, imToken) =>
  loginToOpenIM(userId, imToken, { forceRelogin: true }),
);
registerIMLogoutExecutor(() => logoutFromOpenIM());

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

      await RNFS.mkdir(dataDir, { NSURLIsExcludedFromBackupKey: true });

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
        // SDK 的 stdout 是 native 侧直接写的，babel 的 transform-remove-console
        // 管不到它——production 里保持 true 等于把会话 / 消息元数据一直吐给
        // logcat / Console.app（同机任意 app 可读）。落盘日志（logFilePath）不受
        // 影响，线上排查仍按 OPENIM_LOG_LEVEL 走文件。
        isLogStandardOutput: isDev,
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
      reportError(error, { operation: 'openim', kind: 'init' });
      throw error;
    });
  }

  await initPromise;

  return true;
}

/** 是否为 OpenIM 的 10004「资源未加载」错误 —— 僵尸登录态的特征。 */
function isOpenIMResourceNotLoadedError(error: unknown): boolean {
  const code = (error as { code?: number })?.code;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    code === 10004 ||
    message.includes('10004') ||
    message.includes('not load resource') ||
    message.includes('Resource initialization incomplete')
  );
}

/**
 * 轻量只读探针：native SDK 自报 Logged 后，用 getSelfUserInfo 确认资源是否真的可用。
 * 抛 10004 → 资源已卸载（hot-reload / 重装后的僵尸态），返回 false。
 * 其它错误保守地当作已加载，避免无关失败误触发一次重登。
 */
async function isOpenIMSessionResourceLoaded(): Promise<boolean> {
  try {
    await OpenIMSDK.getSelfUserInfo();
    return true;
  } catch (error) {
    if (isOpenIMResourceNotLoadedError(error)) {
      return false;
    }
    return true;
  }
}

/**
 * 登录 OpenIM。
 * 登录前先确保 SDK 已初始化；失败时重置 connecting 状态，防止 store 卡死。
 */
export async function loginToOpenIM(
  userID: string,
  imToken: string,
  options: { forceRelogin?: boolean } = {},
) {
  if (!imToken || !isNativeIMSupported()) {
    if (!isNativeIMSupported()) {
      useIMStore.getState().setError(getUnsupportedPlatformMessage());
    }
    return false;
  }

  try {
    if (logoutPromise) {
      await logoutPromise;
    }
    await ensureOpenIMInitialized();
    const imUserID = toImUserId(userID);
    useIMStore.getState().setCurrentUserID(imUserID);
    useIMStore.getState().setError(null);

    // Hot reload / 重装后 native SDK 进程通常还活着，重复 login 会被 OpenIM 拒成
    // 10102 "User has logged in repeatedly"。先查状态，已登录就复用。
    const status = await OpenIMSDK.getLoginStatus().catch(() => LoginStatus.Logout);
    if (status === LoginStatus.Logged && options.forceRelogin) {
      // token 恢复路径（review 修复 P1）：SDK 仍自报 Logged，但手里的 token 已被
      // 服务端拒绝 —— 复用快捷会「成功返回」却让 SDK 继续拿着死 token 收发全断。
      // 先 logout 拆干净（失败不阻断：僵尸态下 login 自会失败并走恢复重试），
      // 落到下面用新 token 干净重登。
      try {
        await OpenIMSDK.logout();
      } catch (error) {
        reportError(error, { operation: 'openim', kind: 'forceReloginLogout' });
      }
    } else if (status === LoginStatus.Logged) {
      // 但「自报 Logged」不等于资源还在：hot-reload / devicectl 覆盖重装后，SDK 常
      // 停在「已登录但资源已卸载」的僵尸态 —— getLoginStatus 仍回 Logged，可任何真实
      // 调用都抛 10004，会话列表被拉空。探针确认资源是否真的可用。
      if (await isOpenIMSessionResourceLoaded()) {
        useIMStore.getState().setConnecting(false);
        useIMStore.getState().setConnected(true);
        return true;
      }

      if (staleLoginSelfHealAttempted) {
        // 本生命周期已自愈过一次仍是僵尸态：不再重置，避免登录环路。沿用旧行为标记
        // 已连，交给 onConnectSuccess / 后续拉取兜底，或由用户冷启动彻底恢复。
        if (isDev) {
          console.warn(
            '[openim] 资源在一次自愈后仍未加载，跳过后续重置（请冷启动 app）',
          );
        }
        useIMStore.getState().setConnecting(false);
        useIMStore.getState().setConnected(true);
        return true;
      }

      // 僵尸态自愈：login() 会撞 10102、logout() 会撞 10004，都救不回来 —— 必须
      // unInitSDK 彻底拆除，再 initSDK + login 才能重载资源。每个生命周期只做一次。
      staleLoginSelfHealAttempted = true;
      if (isDev) {
        console.warn('[openim] 检测到僵尸登录态（资源已卸载），重建 SDK 后重登');
      }
      try {
        await OpenIMSDK.unInitSDK();
      } catch (error) {
        // 拆除失败不阻断：下面 ensureOpenIMInitialized 仍会尝试重建。
        reportError(error, { operation: 'openim', kind: 'unInit' });
      }
      initPromise = null;
      useIMStore.getState().reset();
      await ensureOpenIMInitialized();
      useIMStore.getState().setCurrentUserID(imUserID);
      useIMStore.getState().setError(null);
      // 落到下面走一次干净 login。
    }

    useIMStore.getState().setConnecting(true);
    await OpenIMSDK.login({
      userID: imUserID,
      token: imToken,
    });
    // 干净登录成功：允许后续（下次 reload 的新僵尸态）再次自愈。
    staleLoginSelfHealAttempted = false;

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
    reportError(error, { operation: 'openim', kind: 'login' });
    throw error;
  }
}

/**
 * 登出 OpenIM，并重置所有 IM 状态。
 * 无论 SDK logout 是否成功都会清空本地状态。
 * 登出后清空 initPromise，下次登录时会重新执行 initSDK。
 */
/**
 * IM 登出 teardown：解绑监听器 → 清空 init 单例 → 重置 store。
 * 解绑是关键——否则账号 A 的 OpenIMSDK.on(...) handler 会常驻进账号 B 的会话；
 * 置空 initPromise 后下次登录会重新 initSDK，并由 bindOpenIMListeners 干净重绑。
 * 幂等：未初始化 / 未绑定时各步骤均为安全 no-op。
 */
function finalizeIMTeardown() {
  unbindOpenIMListeners();
  initPromise = null;
  useIMStore.getState().reset();
}

async function performLogoutFromOpenIM() {
  if (!isNativeIMSupported() || !initPromise) {
    finalizeIMTeardown();
    return;
  }

  // SDK 已初始化但未连接（登录还在进行 / 登录失败 / 已断开）时，没有可登出的会话，
  // 直接 OpenIMSDK.logout() 会报 10004「Resource initialization incomplete」。
  // 此时跳过 SDK logout、只清本地状态并重置 initPromise（下次登录会重新 initSDK）。
  if (!useIMStore.getState().connected) {
    finalizeIMTeardown();
    return;
  }

  try {
    await OpenIMSDK.logout();
  } catch (err) {
    // SDK 登出失败不阻断本地清理；dev 下打印出来，避免 native 端长期处于异常状态而没人发现。
    // 同时上报，让生产环境也有可见性（之前只有 dev console）。
    if (isDev) {
      console.warn('[openim] SDK logout failed (local state still reset)', err);
    }
    reportError(err, { operation: 'openim', kind: 'logout' });
  } finally {
    finalizeIMTeardown();
  }
}

export function logoutFromOpenIM(): Promise<void> {
  if (logoutPromise) {
    return logoutPromise;
  }

  const operation = performLogoutFromOpenIM();
  let trackedOperation: Promise<void>;
  trackedOperation = operation.finally(() => {
    if (logoutPromise === trackedOperation) {
      logoutPromise = null;
    }
  });
  logoutPromise = trackedOperation;
  return trackedOperation;
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
  // 乐观发送钩子：消息创建后（发送中状态）立即回调，调用方可先上屏再等网络确认。
  onCreate?: (message: MessageItem) => void;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const message = await OpenIMSDK.createTextMessage(params.text);
  params.onCreate?.(message);
  const isSingle = params.sessionType === SessionType.Single;
  const sentMessage = await reportSend({
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

export async function sendTextAtMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  text: string;
  atUserList: string[];
  atUsersInfo?: { userID: string; nickname: string }[];
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const message = await OpenIMSDK.createTextAtMessage({
    text: params.text,
    atUserIDList: params.atUserList,
    atUsersInfo: params.atUsersInfo?.map((item) => ({
      atUserID: item.userID,
      groupNickname: item.nickname,
    })),
  });
  const isSingle = params.sessionType === SessionType.Single;
  return reportSend({
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
}

export async function sendQuoteMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  text: string;
  message: MessageItem;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const message = await OpenIMSDK.createQuoteMessage({
    text: params.text,
    message: params.message,
  });
  const isSingle = params.sessionType === SessionType.Single;
  return reportSend({
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
  thumbUrl?: string;
  thumbWidth?: number;
  thumbHeight?: number;
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
  // 列表气泡用缩略图(snapshotPicture)显示，避免逐张拉全尺寸原图；缩略图缺失
  // （生成失败 / 原图已够小）时退化为原图，行为与之前一致。
  const snapshotPicture = params.thumbUrl
    ? {
        uuid: '',
        type: 'image/jpeg',
        size: 0,
        width: params.thumbWidth ?? 0,
        height: params.thumbHeight ?? 0,
        url: params.thumbUrl,
      }
    : picBase;
  // SDK 需要本地路径不带 file:// 前缀（播放端用 toPlayableUri 还原 scheme）
  const localPath = stripFileScheme(params.sourcePath);
  const message = await OpenIMSDK.createImageMessageByURL({
    sourcePicture: picBase,
    bigPicture: picBase,
    snapshotPicture,
    sourcePath: localPath,
  });

  const isSingle = params.sessionType === SessionType.Single;
  return reportSend({
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
  return reportSend({
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
  return reportSend({
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
  return reportSend({
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
  return reportSend({
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

/**
 * Marks a locally-inserted "you're now friends" system notice. Rendered as a
 * centered gray line (same as OpenIM's native FriendAdded). Never sent to the
 * server — see insertLocalFriendAddedNotice.
 */
export const FRIEND_ADDED_NOTICE_EXTENSION = 'friend-added-notice-v1';

export interface TransferCardPayload {
  amount: number;
  message: string | null;
}

/**
 * WeChat-style guarantee for the "你们已经是好友了" line: insert a local-only
 * system notice into the single conversation with `friendUserID` right after a
 * friend request is accepted, so the chat is never empty even if OpenIM's
 * native FriendAdded notification is delayed or never emitted (admin
 * import_friend may not emit one).
 *
 * Local-only (insertSingleMessageToLocalStorage — never hits the server). Sent
 * as `self → friend` so it doesn't bump the unread count. If the native
 * FriendAdded also arrives, the chat screen dedupes the two identical notices.
 * Best-effort: callers should not let a failure here block the accept flow.
 */
export async function insertLocalFriendAddedNotice(params: {
  selfUserID: string;
  friendUserID: string;
}): Promise<void> {
  const initialized = await ensureOpenIMInitialized();
  if (!initialized) return;

  const message = await OpenIMSDK.createCustomMessage({
    data: JSON.stringify({ kind: 'friend_added' }),
    extension: FRIEND_ADDED_NOTICE_EXTENSION,
    description: '',
  });

  await OpenIMSDK.insertSingleMessageToLocalStorage({
    message,
    sendID: toImUserId(params.selfUserID),
    recvID: toImUserId(params.friendUserID),
  });
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
  return reportSend({
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
  return reportSend({
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
 * 把笔记卡片发到指定会话（好友或群聊）—— 供"分享笔记到聊天"的会话选择器用。
 * 按会话解析 recvID/groupID（与 friend/circle 名片一致），避免调用方自己拼
 * sourceID/sessionType 时踩 IM/业务 id 转换的坑。
 */
export async function sendNoteCardToConversation(params: {
  targetConversationID: string;
  payload: NoteCardPayload;
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

  const message = await OpenIMSDK.createCustomMessage({
    data: JSON.stringify(params.payload),
    extension: NOTE_CARD_EXTENSION,
    description: `[笔记] ${params.payload.title}`,
  });

  const isGroup =
    targetConversation.conversationType === SessionType.Group;
  return reportSend({
    recvID: isGroup ? '' : targetConversation.userID,
    groupID: isGroup ? targetConversation.groupID : '',
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
 * Circle plaza-post share card. Wraps a circle post (活动/帖子) as a rich bubble
 * so recipients see title / cover / circle / signups and tap through to detail.
 * Used by the "share post to chat" entry and the signup → chat auto flow.
 */
export const PLAZA_POST_CARD_EXTENSION = 'plaza-post-card-v1';

function plazaPostCardPreview(payload: PlazaPostCardData) {
  return `[活动] ${payload.title}`;
}

export async function sendPlazaPostCardMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  payload: PlazaPostCardData;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const preview = plazaPostCardPreview(params.payload);
  const message = await OpenIMSDK.createCustomMessage({
    data: JSON.stringify(params.payload),
    extension: PLAZA_POST_CARD_EXTENSION,
    description: preview,
  });

  const isSingle = params.sessionType === SessionType.Single;
  return reportSend({
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

/**
 * Circle-verification invite card. Sent to a friend when the applicant adds
 * them as a verifier; tapping it opens the verify screen to approve/reject.
 */
export const VERIFICATION_CARD_EXTENSION = 'circle-verify-v1';

export interface VerificationCardPayload {
  invitationId: string;
  circleName: string;
  applicantName: string;
}

export async function sendVerificationCardMessage(params: {
  sourceID: string;
  sessionType: SessionType;
  payload: VerificationCardPayload;
}) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await waitForOpenIMConnectionReady();

  const preview = `[验证] ${params.payload.applicantName} 邀请你为入圈申请担保`;
  const message = await OpenIMSDK.createCustomMessage({
    data: JSON.stringify(params.payload),
    extension: VERIFICATION_CARD_EXTENSION,
    description: preview,
  });

  const isSingle = params.sessionType === SessionType.Single;
  return reportSend({
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

  return reportSend({
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
  avatarUrl: string | null;
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

  const ext: CircleCardExt = {
    v: CIRCLE_CARD_EXT_VERSION,
    kind: 'circle',
    avatarUrl: params.avatarUrl ?? null,
  };
  const message = await OpenIMSDK.createCardMessage({
    // 圈子 id 存在 card 的 userID 槽里 —— 收件人点名片靠它打开圈子详情。
    userID: params.circleId,
    nickname: params.name,
    faceURL: params.avatarUrl ?? '',
    ex: JSON.stringify(ext),
  });
  const isGroupConversation =
    targetConversation.conversationType === SessionType.Group;

  return reportSend({
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

export async function deleteLocalMessage(conversationID: string, clientMsgID: string) {
  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    throw new Error(getUnsupportedPlatformMessage());
  }

  await OpenIMSDK.deleteMessageFromLocalStorage({ conversationID, clientMsgID });
  const state = useIMStore.getState();
  const currentMessages = state.messagesByConversation[conversationID];
  if (Array.isArray(currentMessages)) {
    state.setMessages(
      conversationID,
      currentMessages.filter((message) => message.clientMsgID !== clientMsgID),
    );
  }
  await loadConversationMessages(conversationID).catch(() => {
    // 删除已完成；刷新失败时等待下一次进入会话重新拉取本地历史。
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

// 全局搜索：跨所有会话按关键词搜文本消息。传空 conversationID 让 OpenIM 做全局检索，
// 返回按会话分组的结果（每组带会话信息 + 命中消息列表），供搜索页「聊天记录」段用。
export async function searchAllTextMessages(params: {
  keyword: string;
  pageIndex?: number;
  count?: number;
}): Promise<SearchMessageResultItem[]> {
  const keyword = params.keyword.trim();

  if (!keyword) {
    return [];
  }

  const initialized = await ensureOpenIMInitialized();

  if (!initialized) {
    return [];
  }

  const result = await OpenIMSDK.searchLocalMessages({
    conversationID: '',
    keywordList: [keyword],
    keywordListMatchType: 0,
    messageTypeList: [MessageType.TextMessage],
    pageIndex: params.pageIndex ?? 1,
    count: params.count ?? 50,
  });
  return result.searchResultItems ?? result.findResultItems ?? [];
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
