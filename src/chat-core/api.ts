import { apiClient } from '@/services/api/client';
import { markGroupWrite } from '@/services/api/group-writes';
import { collectCursorPages, readHasMore } from '@/services/api/pagination';
import { reportHandledFailure } from '@/observability/report-failure';
import { retry } from '@/utils/retry';
import { useAuthStore } from '@/stores/authStore';
import type {
  ChatBurnPolicyDto,
  ChatConversationDto,
  ChatGroupEventsPageDto,
  ChatGroupPoliciesDto,
  ChatHistoryPageDto,
  ChatMemberDto,
  ChatMemberSilenceDto,
  ChatMessageDto,
  ChatSyncPageDto,
} from './protocol';
import { resolveLocalDaySearchWindow } from '../features/chat/chat-history-date-window';
import { isMessageDeletedLocally, withoutLocallyDeleted } from './deleted-messages';
import { getKnownClearTargetHeight } from './clear-history-target';
import {
  deleteLocalMessagesBelow,
  readRecentLocalMessages,
  searchLocalChatMessages,
} from './local-db';
import { conversationsLeftSince, sortConversations, useChatStore } from './store';

/**
 * chat-core 的 REST 冷路径(circle_be /api/v1/chat/*)。
 * 实时收发走 socket-manager;这里承担打开 App/进页面时的全量拉取与翻页。
 */

/**
 * 会话世代闸:发请求前记下 sessionEpoch,写 store 前再比一次。
 *
 * apiClient 只在 401 刷新路径上校验 epoch —— 一个正常成功的响应会无条件返回。
 * 于是账号 A 的在途请求可以在用户切到 B 之后落地,把 A 的会话名/对端/预览/
 * 未读写进 B 的 store,直到下一次刷新为止(跨账号隐私泄漏)。
 * sessionEpoch 在登录/切号(setSession)与登出(clearSession)时自增,
 * token 轮换(setTokens)不动它 —— 正是这里需要的判据。
 */
function sessionGate(): () => boolean {
  const epoch = useAuthStore.getState().sessionEpoch;
  return () => useAuthStore.getState().sessionEpoch === epoch;
}

type PendingHistoryClear = { targetHeight: number | undefined };
const pendingHistoryClears = new Map<string, PendingHistoryClear>();
let pendingHistoryClearEpoch: number | null = null;

// 启动时 socket、消息页 focus、回前台恢复可能同时请求会话列表。把同一账号
// 的并发请求合并成一个，避免慢响应互相覆盖，也避免首屏为了补一次快照把服务端
// 打出多份完全相同的查询。切号时允许新账号立即发起自己的请求。
let conversationsRequest: Promise<ChatConversationDto[]> | null = null;
let conversationsRequestEpoch: number | null = null;

function getPendingHistoryClear(
  conversationId: string,
  forEveryone: boolean,
): PendingHistoryClear {
  const epoch = useAuthStore.getState().sessionEpoch;
  if (pendingHistoryClearEpoch !== epoch) {
    pendingHistoryClears.clear();
    pendingHistoryClearEpoch = epoch;
  }
  const key = `${conversationId}:${forEveryone ? 'everyone' : 'self'}`;
  const pending = pendingHistoryClears.get(key);
  if (pending) return pending;

  const store = useChatStore.getState();
  // 拿不到本地水位就不要传 targetHeight —— 服务端对 undefined 会退到会话当前
  // 顶端(targetHeight ?? currentTop),对 0 则走 `clearThrough <= 0` 直接返回、
  // 一条都不清。而本地水位缺失是常态:时间线没加载、上一次"仅清我的"已经把
  // lastMessage 置空、或从消息列表侧滑删除。传 0 的话服务端什么都没做,客户端
  // 却照样清空本地并提示"已清空",群聊里其他人的记录原封不动。
  const operation = {
    targetHeight: getKnownClearTargetHeight(
      store.conversations.find((conversation) => conversation.id === conversationId),
      store.messagesByConversation[conversationId] ?? [],
    ),
  };
  pendingHistoryClears.set(key, operation);
  return operation;
}

function completePendingHistoryClear(
  conversationId: string,
  forEveryone: boolean,
  operation: PendingHistoryClear,
) {
  const key = `${conversationId}:${forEveryone ? 'everyone' : 'self'}`;
  if (pendingHistoryClears.get(key) === operation) {
    pendingHistoryClears.delete(key);
  }
}

/**
 * 本次登录期间已经把本地库时间线读进过内存的会话。冷启动只预读最近活跃的那批,其余的
 * 第一次打开时读;不能拿「内存里有没有消息」来判断 —— 没预读的会话收到一条实时消息后
 * 内存里就有了这一条,却从没读过本地那几十条缓存(离线时整个会话只剩这一条)。
 */
let localTimelineReads: { epoch: number; ids: Set<string> } | null = null;

function localTimelineReadSet(): Set<string> {
  const epoch = useAuthStore.getState().sessionEpoch;
  if (!localTimelineReads || localTimelineReads.epoch !== epoch) {
    localTimelineReads = { epoch, ids: new Set() };
  }
  return localTimelineReads.ids;
}

export function hasReadLocalTimeline(conversationId: string): boolean {
  return localTimelineReadSet().has(conversationId);
}

/** 冷启动预读完、或第一次打开时读完本地时间线后记一笔。 */
export function markLocalTimelinesRead(conversationIds: Iterable<string>): void {
  const reads = localTimelineReadSet();
  for (const id of conversationIds) reads.add(id);
}

/**
 * 本地库里已经过了焚毁时刻、但还没被清理掉的消息。清理定时器只按内存里的到期时刻排,
 * 没预读进内存的会话没人替它定时 —— 从本地读出来(打开会话、全局搜索)时在内存里
 * 先滤掉,并在后台补一次清理(那是几条全表 UPDATE/DELETE,不能每次读都同步跑)。
 */
function withoutExpiredBurn<T extends { burnExpiresAt?: string | null }>(
  messages: readonly T[],
  now = Date.now(),
): T[] {
  const kept = messages.filter((message) => {
    if (!message.burnExpiresAt) return true;
    const expiresAt = Date.parse(message.burnExpiresAt);
    return !Number.isFinite(expiresAt) || expiresAt > now;
  });
  if (kept.length !== messages.length) {
    try {
      void useChatStore.getState().purgeExpiredBurnMessages();
    } catch (error) {
      reportHandledFailure('chatSync', 'expiredLocalPurge', error);
    }
  }
  return kept;
}

const CONVERSATION_PAGE_LIMIT = 500;
/** 键集翻页的安全上限:20 页 × 500 = 1 万个会话。 */
const CONVERSATION_MAX_PAGES = 20;

let lastConversationSnapshot: { epoch: number; at: number } | null = null;

/**
 * 当前账号最近一次完整会话快照落地后是否还没超过 maxAgeMs。时刻记的是请求**发出**
 * 的时候(数据就是那一刻的),时钟回拨(差值为负)一律当作不新鲜。
 */
export function isConversationSnapshotFresh(maxAgeMs: number, now = Date.now()): boolean {
  const snapshot = lastConversationSnapshot;
  if (!snapshot || snapshot.epoch !== useAuthStore.getState().sessionEpoch) return false;
  const age = now - snapshot.at;
  return age >= 0 && age <= maxAgeMs;
}

/** 回到消息页/群聊页时的重拉节流窗口。 */
const FOCUS_RELOAD_FRESH_MS = 30_000;

/**
 * 回到页面时能不能跳过这次全量重拉:实时连接正常、store 里是完整快照、且刚拉过。
 * 会话变化靠实时事件推送(入群/退群/被移出/偏好变更都有会话事件,建群会就地写 store),
 * 重连时 socket-manager 总会重拉一次;下拉刷新不受影响。
 * 群一多,一次全量会话快照就是几百 KB 的 JSON,来回切页面每次都拉很费电。
 */
export function canSkipConversationFocusReload(): boolean {
  return hasFreshConversationSnapshot(FOCUS_RELOAD_FRESH_MS);
}

/** 实时连接正常、store 里是完整快照、且快照不超过 maxAgeMs。 */
function hasFreshConversationSnapshot(maxAgeMs: number): boolean {
  const state = useChatStore.getState();
  return (
    state.connected &&
    state.conversationsSnapshotLoaded &&
    isConversationSnapshotFresh(maxAgeMs)
  );
}

/** 列表类页面(入群申请里的「已加入」等)复用会话快照的窗口。 */
const LIST_REUSE_FRESH_MS = 2 * 60_000;

/**
 * 页面需要整张会话列表时用:手上有新鲜的完整快照(实时连接正常时会话变化靠事件推送)
 * 就直接用 store 里那份,否则照常拉。群一多,每打开一次就全量拉一次很费电。
 */
export function ensureChatConversations(
  options: { force?: boolean } = {},
): Promise<ChatConversationDto[]> {
  // force:用户主动下拉刷新,不复用。
  if (!options.force && hasFreshConversationSnapshot(LIST_REUSE_FRESH_MS)) {
    return Promise.resolve(useChatStore.getState().conversations);
  }
  return loadChatConversations();
}

/**
 * 页面只关心某一个会话的最新元信息时用(群管理、群笔记管理读它的 policies / myRole):
 * 只取这一个;老服务端没有单个会话接口、或单取失败时退回整表重拉。
 */
export async function refreshConversationOrList(conversationId: string): Promise<void> {
  try {
    await refreshChatConversation(conversationId);
  } catch (error) {
    // 断网:整表同样拉不到,不必再失败一次。
    if ((error as { status?: unknown } | null)?.status === 0) throw error;
    await loadChatConversations();
  }
}

function isBadRequest(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 400;
}

/**
 * 当前账号的服务端支不支持会话列表的键集游标(null = 还不知道)。知道支持之后直接按
 * 游标翻,省掉那一发会被丢弃的旧模式第一页;知道不支持就不再试探(老服务端每次都 400)。
 */
let keysetSupport: { epoch: number; supported: boolean } | null = null;

function keysetSupportFor(epoch: number): boolean | null {
  return keysetSupport && keysetSupport.epoch === epoch ? keysetSupport.supported : null;
}

class KeysetUnsupportedError extends Error {}

/**
 * 按会话 id 键集游标把全部会话取齐。第一页按活跃度排序,翻页期间来新消息会让会话在
 * 页与页之间挪位,按偏移翻会漏会重;id 顺序稳定,取齐之后按活跃度排好再返回
 * (增量同步按返回顺序排队,最近的会话要先追平)。
 *
 * 老服务端不认 cursor(白名单校验 400),或静默忽略它(说「后面还有」却不给游标)时
 * 抛 KeysetUnsupportedError,由调用方退回旧模式。其他失败原样抛出 —— 不能拿一份
 * 截断的列表去整表替换,500 以后的会话会从列表和角标里消失。
 */
async function walkConversationCursor(
  sameSession: () => boolean,
  onFirstAttempt: () => void,
): Promise<ChatConversationDto[]> {
  let first = true;
  let sessionChanged = false;
  const all = await collectCursorPages(
    async (cursor) => {
      // 换了账号:旧账号的游标不能拿新账号的 token 接着翻(还会占新账号的限流额度)。
      if (!sameSession()) {
        sessionChanged = true;
        return { rows: [], nextCursor: null };
      }
      const signal = { hasMore: null as boolean | null, nextCursor: null as string | null };
      let rows: ChatConversationDto[];
      try {
        rows = await retry(
          () => {
            if (first) onFirstAttempt();
            return apiClient<ChatConversationDto[]>(
              `/chat/conversations?limit=${CONVERSATION_PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}`,
              {
                onResponseHeaders: (headers) => {
                  signal.hasMore = readHasMore(headers);
                  signal.nextCursor = headers.get('X-Next-Cursor');
                },
              },
            );
          },
          { tries: 2, backoffMs: 400 },
        );
      } catch (error) {
        if (isBadRequest(error)) throw new KeysetUnsupportedError();
        throw error;
      }
      first = false;
      if (signal.hasMore === true && !signal.nextCursor) throw new KeysetUnsupportedError();
      return { rows, nextCursor: signal.nextCursor };
    },
    { maxPages: CONVERSATION_MAX_PAGES },
  );
  return sessionChanged ? all : sortConversations(all);
}

export interface LoadChatConversationsOptions {
  /**
   * 要一份「此刻之后才发出」的快照,不复用在途请求。
   *
   * 会话元信息刚变更时(群公告/头像/群主、陌生会话的第一条消息),在途的那次
   * 请求可能发在服务端落库之前,复用它拿回来的就是旧快照。新请求排在在途请求
   * 之后再发而不是并行:并行的两发谁后回来谁说了算,旧快照会盖掉新快照。
   */
  fresh?: boolean;
}

/** 拉全量会话列表并写入 store(消息页 focus / 下拉刷新用)。 */
export async function loadChatConversations(
  options: LoadChatConversationsOptions = {},
): Promise<ChatConversationDto[]> {
  const requestEpoch = useAuthStore.getState().sessionEpoch;
  const inFlight =
    conversationsRequest && conversationsRequestEpoch === requestEpoch
      ? conversationsRequest
      : null;
  if (inFlight && !options.fresh) return inFlight;

  const sameSession = sessionGate();
  const request = (async () => {
    // 在途请求的成败与这一发无关,只等它先落地。
    if (inFlight) await inFlight.then(() => undefined, () => undefined);
    let requestPreviewRevision: number | undefined;
    // Capture each actual attempt after any queued request/retry wait.
    const captureRevision = () => {
      requestPreviewRevision = useChatStore.getState().conversationPreviewRevision;
    };
    // 新鲜度按请求发出的时刻算:快照就是那一刻的数据,翻多页也不往后延。
    const startedAt = Date.now();
    const conversations = await loadConversationSnapshot(
      requestEpoch,
      sameSession,
      captureRevision,
    );
    if (sameSession()) {
      await hydrateTimelinesBehindDeletedPreviews(conversations, sameSession);
    }
    if (!sameSession()) return conversations;
    useChatStore.getState().setConversations(conversations, requestPreviewRevision);
    lastConversationSnapshot = { epoch: requestEpoch, at: startedAt };
    const left = conversationsLeftSince(requestPreviewRevision);
    return left.size === 0
      ? conversations
      : conversations.filter((conversation) => !left.has(conversation.id));
  })();
  conversationsRequest = request;
  conversationsRequestEpoch = requestEpoch;
  const clearRequest = () => {
    if (conversationsRequest === request) {
      conversationsRequest = null;
      conversationsRequestEpoch = null;
    }
  };
  // 用 then(success, failure) 清理，不能把 finally 产生的 rejected Promise
  // 丢掉，否则一次网络失败会在没有调用方 await 时变成 unhandled rejection。
  void request.then(clearRequest, clearRequest);
  return request;
}

/**
 * 一份完整的会话快照。已知支持游标就直接按游标翻;否则先发旧模式第一页
 * (`limit=500`,多数账号一页就够),被截断(X-Has-More: true)再按游标取齐。
 */
async function loadConversationSnapshot(
  epoch: number,
  sameSession: () => boolean,
  captureRevision: () => void,
): Promise<ChatConversationDto[]> {
  const support = keysetSupportFor(epoch);
  if (support === true) {
    try {
      return await walkConversationCursor(sameSession, captureRevision);
    } catch (error) {
      if (!(error instanceof KeysetUnsupportedError)) throw error;
      // 服务端回滚到了老版本:记下来,这一发退回旧模式。
      keysetSupport = { epoch, supported: false };
    }
  }

  const firstPageSignal = { hasMore: null as boolean | null };
  // 启动阶段常见的是一次网络/网关抖动，而不是会话不存在。GET 列表请求
  // 可安全重试一次；确定性的 4xx 仍由 retry 立即抛出，避免掩盖认证问题。
  const firstPage = await retry(
    // Backend defaults this endpoint to 100 rows; ask for its maximum so most
    // accounts get the whole list in one request. Beyond that the server sets
    // X-Has-More and the rest is fetched by keyset cursor.
    () => {
      captureRevision();
      return apiClient<ChatConversationDto[]>('/chat/conversations?limit=500', {
        onResponseHeaders: (headers) => {
          firstPageSignal.hasMore = readHasMore(headers);
        },
      });
    },
    { tries: 2, backoffMs: 400 },
  );
  if (firstPageSignal.hasMore !== true || keysetSupportFor(epoch) === false) {
    return firstPage;
  }
  try {
    // 首发的预览修订号已经记在第一页上(更早,更保守),这里不再覆盖。
    const all = await walkConversationCursor(sameSession, () => undefined);
    keysetSupport = { epoch, supported: true };
    return all;
  } catch (error) {
    if (!(error instanceof KeysetUnsupportedError)) throw error;
    // 老服务端:与之前的行为一致,只有第一页。记下来,之后不再试探。
    keysetSupport = { epoch, supported: false };
    return firstPage;
  }
}

/**
 * 会话末条被本机删掉了、而这个会话的本地时间线还没读进内存(冷启动只预读最近活跃的
 * 那批):先把本地最近几十条读进来,setConversations 才能把预览回退到上一条,
 * 而不是变成空白。服务端不知道本机的删除墓碑,快照里末条还是那条被删的。
 */
async function hydrateTimelinesBehindDeletedPreviews(
  conversations: readonly ChatConversationDto[],
  sameSession: () => boolean,
): Promise<void> {
  for (const conversation of conversations) {
    const last = conversation.lastMessage;
    if (!last || !isMessageDeletedLocally(last.id, last.d)) continue;
    if (hasReadLocalTimeline(conversation.id)) continue;
    const local = withoutExpiredBurn(await readRecentLocalMessages(conversation.id, 50));
    if (!sameSession()) return;
    markLocalTimelinesRead([conversation.id]);
    if (local.length > 0) {
      void useChatStore.getState().ingestMessages(conversation.id, local, { persist: false });
    }
  }
}

/** GET /chat/conversations/:id 的这两个错误码表示会话已不在本人列表里(已退出 / 已隐藏)。 */
const CONVERSATION_GONE_CODES: ReadonlySet<string> = new Set([
  'CHAT_NOT_MEMBER',
  'CHAT_CONVERSATION_NOT_FOUND',
]);

export function isConversationGoneError(error: unknown): boolean {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === 'string' && CONVERSATION_GONE_CODES.has(code);
}

/** 当前账号的服务端有没有单个会话接口(null = 还不知道)。老服务端每次都 404,知道了就不再试。 */
let singleConversationSupport: { epoch: number; supported: boolean } | null = null;

/**
 * 只刷新一个会话(会话元信息变更事件后用):取 GET /chat/conversations/:id,按全量快照
 * 同一套对账合并进列表。群一多,为一条置顶/免打扰/群公告变更重拉整张列表是几百 KB。
 *
 * - 在途的整表请求可能发在这次变更之前:先等它落地,否则它晚到时会拿旧状态盖掉这一行。
 * - 末条被本机删掉、本地时间线又没读过的会话,先读本地时间线(同整表路径),预览才不会变空。
 * - shouldApply 返回 false(比如请求期间收到了移出事件)就丢弃结果,不把会话「复活」。
 * - 失败(老服务端没有这个接口、会话已不在本人列表里、网络)原样抛出,由调用方决定是否整表重拉。
 */
export async function refreshChatConversation(
  conversationId: string,
  options: { shouldApply?: () => boolean } = {},
): Promise<void> {
  const epoch = useAuthStore.getState().sessionEpoch;
  if (singleConversationSupport?.epoch === epoch && !singleConversationSupport.supported) {
    throw Object.assign(new Error('single conversation endpoint unavailable'), { status: 404 });
  }
  const sameSession = sessionGate();
  const inFlight =
    conversationsRequest && conversationsRequestEpoch === epoch ? conversationsRequest : null;
  if (inFlight) await inFlight.then(() => undefined, () => undefined);
  if (!sameSession()) return;
  const requestPreviewRevision = useChatStore.getState().conversationPreviewRevision;
  let conversation: ChatConversationDto;
  try {
    conversation = await apiClient<ChatConversationDto>(
      `/chat/conversations/${encodeURIComponent(conversationId)}`,
    );
  } catch (error) {
    // 没有错误码的 404 = 老服务端没有这个接口:这次登录内不再试,直接走整表。
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 404 && !isConversationGoneError(error)) {
      singleConversationSupport = { epoch, supported: false };
    }
    throw error;
  }
  if (!conversation || typeof conversation !== 'object' || conversation.id !== conversationId) {
    throw new Error('single conversation response did not match the requested id');
  }
  const stillWanted = () => sameSession() && options.shouldApply?.() !== false;
  if (!stillWanted()) return;
  await hydrateTimelinesBehindDeletedPreviews([conversation], sameSession);
  if (!stillWanted()) return;
  useChatStore.getState().mergeConversationSnapshot(conversation, requestPreviewRevision);
}

/** 读取会话级阅后即焚档位（深链/联系人入口可能先于会话列表打开聊天页）。 */
export function fetchChatBurnPolicy(
  conversationId: string,
): Promise<ChatBurnPolicyDto> {
  return apiClient<ChatBurnPolicyDto>(
    `/chat/conversations/${conversationId}/burn`,
  );
}

/** 取或建单聊会话(个人资料页「发消息」等入口)。 */
export function createDirectChatConversation(
  peerUserId: string,
): Promise<ChatConversationDto> {
  return apiClient<ChatConversationDto>('/chat/conversations/direct', {
    method: 'POST',
    body: { peerUserId },
  });
}

/** 取或建圈子群会话(圈子详情「进群聊」等入口;进圈后首次调用即触发座位同步)。 */
export function createCircleChatConversation(
  circleId: string,
): Promise<ChatConversationDto> {
  return apiClient<ChatConversationDto>('/chat/conversations/circle', {
    method: 'POST',
    body: { circleId },
  });
}

/** 创建独立群聊(好友多选;不挂圈子)。群名必填,服务端也会再拒一次空名。 */
export function createGroupChatConversation(input: {
  name: string;
  memberIds: string[];
}): Promise<ChatConversationDto> {
  return markGroupWrite(apiClient<ChatConversationDto>('/chat/conversations/group', {
    method: 'POST',
    body: { name: input.name.trim(), memberIds: input.memberIds },
  }));
}

/** 独立群聊:拉自己的好友进群。 */
export function inviteGroupChatMembers(
  conversationId: string,
  memberIds: string[],
): Promise<ChatConversationDto> {
  return markGroupWrite(apiClient<ChatConversationDto>(
    `/chat/conversations/${conversationId}/members`,
    { method: 'POST', body: { memberIds } },
  ));
}

/** 独立群聊:退出群聊(群主退群服务端自动转移)。 */
export function leaveGroupChatConversation(
  conversationId: string,
): Promise<void> {
  return markGroupWrite(apiClient<void>(`/chat/conversations/${conversationId}/leave`, {
    method: 'POST',
  }));
}

/**
 * 独立群聊:群主解散(微信语义)。群从所有人的列表消失,所有人的记录一并清空。
 * 不可逆 —— 服务端全员离座之后没人能再把群拉起来。
 */
export function dissolveGroupChatConversation(
  conversationId: string,
): Promise<void> {
  return markGroupWrite(apiClient<void>(`/chat/conversations/${conversationId}/dissolve`, {
    method: 'POST',
  }));
}

/** 独立群聊:改群名(任一在座成员)。 */
export function renameGroupChatConversation(
  conversationId: string,
  name: string,
): Promise<ChatConversationDto> {
  return markGroupWrite(apiClient<ChatConversationDto>(
    `/chat/conversations/${conversationId}/name`,
    { method: 'PATCH', body: { name } },
  ));
}

/**
 * 群日志:独立于聊天记录的群事件账本(进退群/移出/角色/禁言/改名/公告/清空/转让),
 * 倒序游标分页。圈子群与成员目录同闸(圈主/管理员),独立群聊全员可读。
 */
export function fetchChatGroupEvents(
  conversationId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ChatGroupEventsPageDto> {
  const query = [
    options.cursor ? `cursor=${encodeURIComponent(options.cursor)}` : '',
    options.limit ? `limit=${options.limit}` : '',
  ]
    .filter(Boolean)
    .join('&');
  return apiClient<ChatGroupEventsPageDto>(
    `/chat/conversations/${conversationId}/events${query ? `?${query}` : ''}`,
  );
}

/** 独立群聊:群主设/撤管理员(圈子群走 services/api/groups 的 updateGroupMemberRole)。 */
export function setGroupChatMemberRole(
  conversationId: string,
  userId: string,
  role: 'ADMIN' | 'MEMBER',
): Promise<{ userId: string; role: 'ADMIN' | 'MEMBER' }> {
  return markGroupWrite(apiClient<{ userId: string; role: 'ADMIN' | 'MEMBER' }>(
    `/chat/conversations/${conversationId}/members/${userId}/role`,
    { method: 'PATCH', body: { role } },
  ));
}

/** 独立群聊:群主/管理员移出成员(圈子群走 services/api/groups 的 removeGroupMember)。 */
export function removeGroupChatMember(
  conversationId: string,
  userId: string,
): Promise<void> {
  return markGroupWrite(apiClient<void>(
    `/chat/conversations/${conversationId}/members/${userId}`,
    { method: 'DELETE' },
  ));
}

/** 禁言成员(两种群;群主/管理员)。durationSec = null 表示直到解除;重复调用覆盖时长。 */
export function silenceChatMember(
  conversationId: string,
  userId: string,
  durationSec: number | null,
): Promise<ChatMemberSilenceDto> {
  return markGroupWrite(apiClient<ChatMemberSilenceDto>(
    `/chat/conversations/${conversationId}/members/${userId}/silence`,
    { method: 'PUT', body: { durationSec } },
  ));
}

/** 解除禁言(两种群;群主/管理员;未禁言时幂等)。 */
export function unsilenceChatMember(
  conversationId: string,
  userId: string,
): Promise<ChatMemberSilenceDto> {
  return markGroupWrite(apiClient<ChatMemberSilenceDto>(
    `/chat/conversations/${conversationId}/members/${userId}/silence`,
    { method: 'DELETE' },
  ));
}

/**
 * 群备注:我给这个群起的名字,**只有我看得见**(对应单聊的好友备注)。
 * 任一在座成员可改自己的;空串清除,回落群名。与群昵称方向相反,互不影响。
 */
export function setMyGroupChatRemark(
  conversationId: string,
  remark: string,
): Promise<{ remark: string | null }> {
  return markGroupWrite(apiClient<{ remark: string | null }>(
    `/chat/conversations/${conversationId}/my-remark`,
    { method: 'PATCH', body: { remark } },
  ));
}

/** 群昵称:改自己在本群的显示名,全群可见。任一在座成员可改;空串清除回落账号昵称。 */
export function setMyGroupChatAlias(
  conversationId: string,
  alias: string,
): Promise<{ alias: string | null }> {
  return markGroupWrite(apiClient<{ alias: string | null }>(
    `/chat/conversations/${conversationId}/my-alias`,
    { method: 'PATCH', body: { alias } },
  ));
}

/** 全员禁言开关(两种群;群主/管理员;管理员与群主豁免)。 */
export function setGroupChatMuteAll(
  conversationId: string,
  enabled: boolean,
): Promise<{ muteAll: boolean }> {
  return markGroupWrite(apiClient<{ muteAll: boolean }>(
    `/chat/conversations/${conversationId}/mute-all`,
    { method: 'PATCH', body: { enabled } },
  ));
}

/** 独立群聊:群主转让(新群主的管理员标记与禁言清零,原群主降为普通成员)。 */
export function transferGroupChatOwner(
  conversationId: string,
  userId: string,
): Promise<void> {
  return markGroupWrite(apiClient<void>(`/chat/conversations/${conversationId}/owner`, {
    method: 'POST',
    body: { userId },
  }));
}

/** 独立群聊:群公告(群主/管理员;空串清空)。 */
export function setGroupChatNotice(
  conversationId: string,
  notice: string,
): Promise<{ notice: string | null }> {
  return markGroupWrite(apiClient<{ notice: string | null }>(
    `/chat/conversations/${conversationId}/notice`,
    { method: 'PATCH', body: { notice } },
  ));
}

/** 独立群聊:群头像(群主/管理员;URL 必须来自本应用存储)。 */
export function setGroupChatAvatar(
  conversationId: string,
  avatarUrl: string,
): Promise<{ avatarUrl: string }> {
  return markGroupWrite(apiClient<{ avatarUrl: string }>(
    `/chat/conversations/${conversationId}/avatar`,
    { method: 'PATCH', body: { avatarUrl } },
  ));
}

/** 群策略开关(两种群;群主/管理员)。只传要改的键。 */
export function updateGroupChatPolicies(
  conversationId: string,
  patch: Partial<ChatGroupPoliciesDto>,
): Promise<ChatGroupPoliciesDto> {
  return markGroupWrite(apiClient<ChatGroupPoliciesDto>(
    `/chat/conversations/${conversationId}/policies`,
    { method: 'PATCH', body: patch },
  ));
}

/**
 * 历史翻页:height 键集向前翻,页内升序;顺手灌进 store。
 *
 * G-01 读路径反转:首屏(无 beforeHeight)先把本地库的最近消息灌进内存立刻
 * 渲染,REST 回来再按 height 对账 —— 断网时首屏就是本地历史。若本地块与
 * 最新页之间有洞(离线太久):洞 ≤1000 条走 afterHeight 补齐,否则放弃旧块
 * (删本地 < 页首,保时间线连续,更早历史仍可 REST 翻页)。
 */
const LOCAL_HOLE_BACKFILL_MAX = 1000;

export async function loadChatHistory(
  conversationId: string,
  options: { beforeHeight?: number; limit?: number } = {},
): Promise<ChatHistoryPageDto> {
  const store = useChatStore.getState();
  // 本地库读也要过世代闸,而且必须**在读之前**记下 epoch 与用户:SQLite 查询
  // 可能在登出/切号之后才 resolve,那时 store 已经属于下一个账号 —— 无条件
  // ingest 就是把上一个账号的私聊内容写进新账号的时间线。
  const sameSession = sessionGate();
  const hydratingUser = store.currentUserId;
  const inMemory = store.messagesByConversation[conversationId] ?? [];
  let localMax = 0;
  if (options.beforeHeight === undefined) {
    if (!hasReadLocalTimeline(conversationId)) {
      const local = withoutExpiredBurn(
        await readRecentLocalMessages(conversationId, options.limit ?? 50),
      );
      const stillCurrent =
        sameSession() && useChatStore.getState().currentUserId === hydratingUser;
      if (stillCurrent) markLocalTimelinesRead([conversationId]);
      if (local.length > 0 && stillCurrent) {
        useChatStore.getState().ingestMessages(conversationId, local);
        for (const message of local) {
          if (message.height > localMax) localMax = message.height;
        }
      } else {
        for (const message of inMemory) {
          if (message.height > localMax) localMax = message.height;
        }
      }
    } else {
      // 冷启动水合已经把这个会话灌进内存了 —— 原来这里只在「内存为空」时
      // 才算 localMax,于是 localMax 恒为 0,下面那段缺口对账整个被跳过:
      // 离线很久之后,旧缓存块和最新一页之间会留一个静默的 height 空洞。
      for (const message of inMemory) {
        if (message.height > localMax) localMax = message.height;
      }
    }
  }
  const params = new URLSearchParams();
  if (options.beforeHeight !== undefined) {
    params.set('beforeHeight', String(options.beforeHeight));
  }
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = params.toString();
  const page = await apiClient<ChatHistoryPageDto>(
    `/chat/conversations/${conversationId}/messages${query ? `?${query}` : ''}`,
  );
  if (sameSession()) {
    useChatStore.getState().ingestMessages(conversationId, page.messages);
    if (localMax > 0) {
      let pageMin = Number.MAX_SAFE_INTEGER;
      for (const message of page.messages) {
        if (message.height > 0 && message.height < pageMin) {
          pageMin = message.height;
        }
      }
      if (pageMin !== Number.MAX_SAFE_INTEGER && pageMin > localMax + 1) {
        const hole = pageMin - localMax - 1;
        if (hole <= LOCAL_HOLE_BACKFILL_MAX) {
          void backfillConversationSince(conversationId, localMax).catch(
            () => undefined,
          );
        } else {
          // 洞太大:旧块整体作废,防止时间线中间静默缺一段。
          //
          // 这里只能「驱逐缓存」,绝不能走 removeMessage —— 那是**用户删除**的
          // 入口,会写一条永久墓碑,于是这些完全正常的服务端消息此后在翻页和
          // 搜索里被永久过滤掉,而注释承诺的只是「以后重新加载」。
          useChatStore.getState().evictMessagesBelow(conversationId, pageMin);
          void deleteLocalMessagesBelow(conversationId, pageMin);
        }
      }
    }
  }
  return page;
}

/**
 * 单页 100。页数上限只是失控兜底 —— 达到上限时**不能**就此收手:
 * nextAfterHeight 还活着就意味着缺口的最新那一段还没到,而普通的向旧翻页
 * 跨不过一个向前的缺口,那段消息在已打开的会话里就永远不出现。
 * 所以到顶之后排下一批继续追,直到游标为 null。
 */
const BACKFILL_PAGE_LIMIT = 100;
const BACKFILL_PAGES_MAX = 10;
const BACKFILL_TOTAL_PAGE_BUDGET = 100;
const BACKFILL_DEADLINE_MS = 30_000;

/**
 * G-13 断线重连对账:从 afterHeight 起升序追平缺口。
 * 与 chat:msg 广播共用 ingestMessages 入库(按 id/d 幂等去重),
 * 追平(nextAfterHeight=null)即停；超过总预算则留下游标，等待下一次重连继续。
 */
export async function backfillConversationSince(
  conversationId: string,
  afterHeight: number,
): Promise<void> {
  let cursor = afterHeight;
  let pagesFetched = 0;
  const deadline = Date.now() + BACKFILL_DEADLINE_MS;
  while (pagesFetched < BACKFILL_TOTAL_PAGE_BUDGET) {
    if (Date.now() >= deadline) {
      reportHandledFailure('chatSync', 'backfillBudgetExceeded', {
        conversationId,
        afterHeight,
        pagesFetched,
      });
      return;
    }
    let batchPages = 0;
    for (; batchPages < BACKFILL_PAGES_MAX; batchPages += 1) {
      pagesFetched += 1;
      const params = new URLSearchParams();
      params.set('afterHeight', String(cursor));
      params.set('limit', String(BACKFILL_PAGE_LIMIT));
      const sameSession = sessionGate();
      const dto = await apiClient<ChatHistoryPageDto>(
        `/chat/conversations/${conversationId}/messages?${params.toString()}`,
      );
      if (!sameSession()) return;
      useChatStore.getState().ingestMessages(conversationId, dto.messages);
      if (dto.nextAfterHeight == null) return;
      // 游标不前进 = 服务端在原地打转,继续追只会死循环。
      if (dto.nextAfterHeight <= cursor) return;
      cursor = dto.nextAfterHeight;
      if (pagesFetched >= BACKFILL_TOTAL_PAGE_BUDGET) break;
    }
    if (pagesFetched >= BACKFILL_TOTAL_PAGE_BUDGET) {
      reportHandledFailure('chatSync', 'backfillBudgetExceeded', {
        conversationId,
        afterHeight,
        pagesFetched,
      });
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** 增量同步单页条数(与服务端 SYNC_PAGE_MAX 对齐)。 */
export const SYNC_PAGE_LIMIT = 200;

/**
 * 会话变更序号流的一页(GET /chat/conversations/:id/sync)。
 *
 * 只负责取数:落库、游标推进与内存应用由 sync.ts 在一处收口(游标必须和它覆盖的
 * 变更一起提交)。会话已换人/已登出时返回 null,调用方据此停手。
 */
export async function fetchChatSyncPage(
  conversationId: string,
  afterRevision: number,
): Promise<ChatSyncPageDto | null> {
  const sameSession = sessionGate();
  const params = new URLSearchParams({
    afterRevision: String(afterRevision),
    limit: String(SYNC_PAGE_LIMIT),
  });
  const page = await apiClient<ChatSyncPageDto>(
    `/chat/conversations/${conversationId}/sync?${params.toString()}`,
  );
  return sameSession() ? page : null;
}

/**
 * 聊天记录检索(文本搜/媒体格/按日期)。与 loadChatHistory 的关键区别:
 * 结果**不写入** store —— 过滤后的片段灌进会话时间线会造成"消息缺页"假象。
 */
/**
 * 检索类响应统一过一遍本地删除墓碑。
 *
 * 收口在这一层而不是各个屏幕:聊天记录的文本/媒体/文件/日期四屏加全局搜索都是
 * 直接渲染这些响应、根本不进 store,逐个补容易漏,以后新加的屏还会再漏一次。
 * 漏掉的后果是用户删过的消息在搜索结果里原样重现,点进去还会跳向一条
 * 时间线里根本不存在的目标。
 *
 * 整页被过滤空时要继续翻:nextBeforeHeight 是服务端按**未过滤**的结果给的,
 * 所以「本页 0 条 + 游标非空」完全可能。直接把空页返回去的话,四个历史屏渲染的是
 * 空状态,而继续翻页要靠 onEndReached —— 一个没有内容的列表不会触底,
 * 更早的可见结果就永远够不着了。
 */
type ChatHistorySearchOptions = {
  keyword?: string;
  types?: string[];
  date?: string;
  beforeHeight?: number;
  limit?: number;
};

function fetchChatHistoryPage(
  conversationId: string,
  options: ChatHistorySearchOptions,
): Promise<ChatHistoryPageDto> {
  const params = new URLSearchParams();
  if (options.keyword) params.set('keyword', options.keyword);
  if (options.types?.length) params.set('types', options.types.join(','));
  if (options.date) {
    const window = resolveLocalDaySearchWindow(options.date);
    if (!window) {
      return Promise.resolve({ messages: [], nextBeforeHeight: null });
    }
    const start = new Date(window.positionSeconds * 1000);
    const end = new Date(
      (window.positionSeconds + window.periodSeconds) * 1000,
    );
    params.set('date', options.date);
    params.set('tzOffsetMinutes', String(start.getTimezoneOffset()));
    params.set('tzEndOffsetMinutes', String(end.getTimezoneOffset()));
  }
  if (options.beforeHeight !== undefined) {
    params.set('beforeHeight', String(options.beforeHeight));
  }
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = params.toString();
  return apiClient<ChatHistoryPageDto>(
    `/chat/conversations/${conversationId}/messages${query ? `?${query}` : ''}`,
  );
}

export async function searchChatMessages(
  conversationId: string,
  options: ChatHistorySearchOptions = {},
): Promise<ChatHistoryPageDto> {
  let beforeHeight = options.beforeHeight;

  // 一直追到「有可见结果」或「到头」为止,**不设次数上限**。
  // 上限只是把死路推远:追满 N 页仍全是墓碑时,返回的还是「空列表 + 活游标」,
  // 屏幕照样渲染空态、照样等一个不会来的触底事件。
  // 真正的死循环风险不是页数多,而是服务端返回一个不前进的游标 —— 下面直接拦它。
  for (;;) {
    const page = await fetchChatHistoryPage(conversationId, {
      ...options,
      ...(beforeHeight !== undefined ? { beforeHeight } : {}),
    });
    const messages = withoutLocallyDeleted(page.messages);
    const next = page.nextBeforeHeight;
    // 游标必须严格向更早推进,否则就是原地打转。
    const advanced = next !== null && (beforeHeight === undefined || next < beforeHeight);
    // 停住的游标要**归一成 null 再交出去**。原来是原样返回的,而六个历史列表屏
    // (文本/媒体/文件/日期结果/群日志,以及各自的首页与翻页两条路径)一律写成
    // `setHasMore(page.nextBeforeHeight !== null)` —— 于是 hasMore 永远为真,
    // 用户每滑一下就发一次一模一样的请求,列表一行都不涨,而且永远停不下来。
    // 这个循环本身早就靠 advanced 收了手;把结论咽回去不告诉调用方才是漏的那半。
    // 游标始终用**最后一次**请求返回的那个,否则下一次翻页会退回已经看过的区间。
    if (messages.length > 0 || !advanced) {
      return { ...page, messages, nextBeforeHeight: advanced ? next : null };
    }
    beforeHeight = next;
  }
}

/** 某月内有聊天记录的日期集合(按日期日历上色;客户端时区)。 */
export function fetchChatMessageDays(
  conversationId: string,
  year: number,
  month: number,
): Promise<string[]> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    tzOffsetMinutes: String(new Date().getTimezoneOffset()),
  });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timeZone) params.set('timeZone', timeZone);
  return apiClient<string[]>(
    `/chat/conversations/${conversationId}/message-days?${params.toString()}`,
  );
}

/** 会话成员目录(GROUP 附圈子角色):@ 候选/群昵称表/目录权限共用。 */
export function fetchChatMembers(
  conversationId: string,
): Promise<ChatMemberDto[]> {
  return apiClient<ChatMemberDto[]>(
    `/chat/conversations/${conversationId}/members`,
  );
}

/** 全局搜索(服务端):跨本人全部会话搜文本(最新在前,扁平)。 */
export function searchAllChatMessages(
  keyword: string,
  limit?: number,
): Promise<ChatMessageDto[]> {
  const params = new URLSearchParams({ keyword });
  if (limit !== undefined) params.set('limit', String(limit));
  return apiClient<ChatMessageDto[]>(
    `/chat/messages/search?${params.toString()}`,
  ).then(withoutLocallyDeleted);
}

/**
 * G-03 全局搜索(本地优先):FTS5 离线、瞬时、大小写不敏感;本地无命中
 * (老历史不在本地窗口)才回落服务端。服务端不可达时本地结果就是全部。
 */
export async function searchAllChatMessagesLocalFirst(
  keyword: string,
  limit = 50,
  onLocalResults?: (messages: ChatMessageDto[]) => void,
): Promise<ChatMessageDto[]> {
  const local = withoutExpiredBurn(
    withoutLocallyDeleted(await searchLocalChatMessages(keyword, limit)),
  );
  // 本地结果先给出去。等在服务端那趟上再渲染的话,离线时用户要盯着空列表
  // 一直等到 apiClient 的 15 秒超时 —— 明明结果早就在手上了。
  if (local.length > 0) onLocalResults?.(local);
  try {
    const remote = await searchAllChatMessages(keyword, limit);
    // 本地有命中就不查服务端是错的:本地库每会话只留 500 条,从没打开过的
    // 会话更是一条都没有 —— 一条恰好命中的近期消息,会让整个在线搜索被跳过,
    // 结果缺失、每会话计数也是错的。本地只用来「先出结果」,权威仍是服务端。
    return mergeSearchHits(local, remote, limit);
  } catch {
    // 离线/服务端不可达:本地结果就是全部。
    return local;
  }
}

/** 按 id 去重合并;服务端那份为准,顺序按 createdAt 倒序。 */
function mergeSearchHits(
  local: ChatMessageDto[],
  remote: ChatMessageDto[],
  limit: number,
): ChatMessageDto[] {
  const byId = new Map<string, ChatMessageDto>();
  for (const message of local) byId.set(message.id, message);
  for (const message of remote) byId.set(message.id, message);
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

/** 会话偏好:置顶/免打扰/隐藏。返回最新 DTO 并回写 store。 */
/** G-07 逐条已读回执:读者=已读水位覆盖该消息的成员(排除发送者,上限 200)。 */
export function fetchMessageReaders(
  conversationId: string,
  messageId: string,
): Promise<{
  readers: { id: string; nickname: string; avatarUrl: string | null }[];
  total: number;
}> {
  return apiClient(
    `/chat/conversations/${conversationId}/messages/${messageId}/readers`,
  );
}

/** 设置本人新发送消息的焚毁时长；不会修改其他成员的设置。0=关。 */
export async function setChatBurnDuration(
  conversationId: string,
  seconds: number | null,
): Promise<number | null> {
  const sameSession = sessionGate();
  const result = await apiClient<ChatBurnPolicyDto>(
    `/chat/conversations/${conversationId}/burn`,
    { method: 'POST', body: { seconds: seconds ?? 0 } },
  );
  if (sameSession()) {
    useChatStore
      .getState()
      .applyBurnDuration(
        conversationId,
        result.burnDurationSec ?? null,
        result.burnStartedAt,
      );
  }
  return result.burnDurationSec ?? null;
}

/**
 * G-14 清空聊天记录:私聊由服务端推进双方水位，群聊只推进本人水位；
 * 本地时间线/预览/未读同步清空 —— 不再是「清内存转头又拉回来」的假清空。
 */
export async function clearChatConversationHistory(
  conversationId: string,
  options: { forEveryone?: boolean } = {},
): Promise<void> {
  const sameSession = sessionGate();
  const forEveryone = options.forEveryone ?? false;
  const operation = getPendingHistoryClear(conversationId, forEveryone);
  let result: { clearedBeforeHeight?: number };
  try {
    result = await apiClient<{ clearedBeforeHeight?: number }>(
      `/chat/conversations/${conversationId}/clear`,
      {
        method: 'POST',
        body: {
          forEveryone,
          ...(operation.targetHeight !== undefined
            ? { targetHeight: operation.targetHeight }
            : {}),
        },
      },
    );
  } finally {
    // finally,不是成功之后。这张表的用途是「同一次点击的并发去重」,请求一结束
    // 它就不再 pending 了。原来只在成功路径上删,一次失败就把当时的 targetHeight
    // 钉在表里直到换账号 —— 用户过几分钟重试,清的还是那个旧水位,这中间收到的
    // 消息一条不清,而界面照样提示「已清空」。
    completePendingHistoryClear(conversationId, forEveryone, operation);
  }
  if (sameSession()) {
    // 带上服务端的权威水位:在途的历史请求/延迟的 chat:msg 会在清空之后
    // 落地,没有水位挡的话它们把刚清掉的时间线原样填回来。
    useChatStore
      .getState()
      .clearConversationLocal(conversationId, result?.clearedBeforeHeight);
  }
}

export async function updateChatConversationPreferences(
  conversationId: string,
  prefs: { pinned?: boolean; muted?: boolean; hidden?: boolean },
): Promise<ChatConversationDto> {
  const sameSession = sessionGate();
  const dto = await apiClient<ChatConversationDto>(
    `/chat/conversations/${conversationId}/preferences`,
    { method: 'PATCH', body: prefs },
  );
  if (!sameSession()) return dto;
  const store = useChatStore.getState();
  if (prefs.hidden) {
    store.removeConversation(conversationId);
  } else {
    store.upsertConversation(dto);
  }
  return dto;
}
