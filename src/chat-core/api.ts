import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';
import type {
  ChatConversationDto,
  ChatHistoryPageDto,
  ChatMemberDto,
  ChatMessageDto,
  ChatMutationsPageDto,
} from './protocol';
import { resolveLocalDaySearchWindow } from '../features/chat/chat-history-date-window';
import { withoutLocallyDeleted } from './deleted-messages';
import { getKnownClearTargetHeight } from './clear-history-target';
import {
  deleteLocalMessagesBelow,
  readRecentLocalMessages,
  searchLocalChatMessages,
} from './local-db';
import { useChatStore } from './store';

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

/** 拉全量会话列表并写入 store(消息页 focus / 下拉刷新用)。 */
export async function loadChatConversations(): Promise<ChatConversationDto[]> {
  const sameSession = sessionGate();
  const conversations =
    await apiClient<ChatConversationDto[]>('/chat/conversations');
  if (sameSession()) {
    useChatStore.getState().setConversations(conversations);
  }
  return conversations;
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

/** 创建独立群聊(好友多选;不挂圈子)。 */
export function createGroupChatConversation(input: {
  name?: string | null;
  memberIds: string[];
}): Promise<ChatConversationDto> {
  return apiClient<ChatConversationDto>('/chat/conversations/group', {
    method: 'POST',
    body: {
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      memberIds: input.memberIds,
    },
  });
}

/** 独立群聊:拉自己的好友进群。 */
export function inviteGroupChatMembers(
  conversationId: string,
  memberIds: string[],
): Promise<ChatConversationDto> {
  return apiClient<ChatConversationDto>(
    `/chat/conversations/${conversationId}/members`,
    { method: 'POST', body: { memberIds } },
  );
}

/** 独立群聊:退出群聊(群主退群服务端自动转移)。 */
export function leaveGroupChatConversation(
  conversationId: string,
): Promise<void> {
  return apiClient<void>(`/chat/conversations/${conversationId}/leave`, {
    method: 'POST',
  });
}

/** 独立群聊:改群名(任一在座成员)。 */
export function renameGroupChatConversation(
  conversationId: string,
  name: string,
): Promise<ChatConversationDto> {
  return apiClient<ChatConversationDto>(
    `/chat/conversations/${conversationId}/name`,
    { method: 'PATCH', body: { name } },
  );
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
    if (inMemory.length === 0) {
      const local = await readRecentLocalMessages(
        conversationId,
        options.limit ?? 50,
      );
      if (
        local.length > 0 &&
        sameSession() &&
        useChatStore.getState().currentUserId === hydratingUser
      ) {
        useChatStore.getState().ingestMessages(conversationId, local);
        for (const message of local) {
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

/**
 * G-13 断线重连对账:从 afterHeight 起升序追平缺口。
 * 与 chat:msg 广播共用 ingestMessages 入库(按 id/d 幂等去重),
 * 追平(nextAfterHeight=null)即停。
 */
export async function backfillConversationSince(
  conversationId: string,
  afterHeight: number,
): Promise<void> {
  let cursor = afterHeight;
  for (let page = 0; page < BACKFILL_PAGES_MAX; page += 1) {
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
  }
  // 一批 1000 条追完游标还活着:让出一轮事件循环再接着追,别把 UI 卡死。
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await backfillConversationSince(conversationId, cursor);
}

/**
 * 离线期间的撤回/编辑增量。撤回不改 height,重连的 afterHeight 补拉结构上
 * 永远看不到它 —— 不追这一趟,断线时被撤回的消息在本地会一直显示原文。
 *
 * 返回服务端给的下一次游标与「还有没有」。**必须用 nextSince 而不是
 * serverTime**:单页有上限,被截断时服务端会把游标停在本页最后一次变更上,
 * 拿 serverTime 前进的话没返回的那些变更就被永久跳过了。
 * 会话已换人/已登出时返回 null(调用方据此停手)。
 */
export async function fetchChatMutationsSince(
  since: string,
  sinceId = '',
): Promise<ChatMutationsPageDto | null> {
  const sameSession = sessionGate();
  const params = new URLSearchParams({ since });
  // 复合游标:同毫秒的多条变更跨在页边界上时,只带时间戳会漏掉其余那些。
  if (sinceId) params.set('sinceId', sinceId);
  const result = await apiClient<ChatMutationsPageDto>(
    `/chat/messages/mutations?${params.toString()}`,
  );
  if (!sameSession()) return null;
  const store = useChatStore.getState();
  const byConversation = new Map<string, ChatMessageDto[]>();
  for (const message of result.messages) {
    const bucket = byConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    byConversation.set(message.conversationId, bucket);
  }
  for (const [conversationId, messages] of byConversation) {
    store.ingestMessages(conversationId, messages);
  }
  return result;
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
    // 游标始终用**最后一次**请求返回的那个,否则下一次翻页会退回已经看过的区间。
    if (messages.length > 0 || next === null) return { ...page, messages };
    // 游标必须严格向更早推进,否则就是原地打转 —— 宁可返回空页也不能挂死。
    if (beforeHeight !== undefined && next >= beforeHeight) {
      return { ...page, messages };
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
  const local = withoutLocallyDeleted(
    await searchLocalChatMessages(keyword, limit),
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

/** S-01 会话级阅后即焚:任一方设置双方生效(GROUP 限圈主/管理员);0=关。 */
export async function setChatBurnDuration(
  conversationId: string,
  seconds: number | null,
): Promise<number | null> {
  const sameSession = sessionGate();
  const result = await apiClient<{ burnDurationSec: number | null }>(
    `/chat/conversations/${conversationId}/burn`,
    { method: 'POST', body: { seconds: seconds ?? 0 } },
  );
  if (sameSession()) {
    useChatStore
      .getState()
      .applyBurnDuration(conversationId, result.burnDurationSec ?? null);
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
  const result = await apiClient<{ clearedBeforeHeight?: number }>(
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
  completePendingHistoryClear(conversationId, forEveryone, operation);
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
