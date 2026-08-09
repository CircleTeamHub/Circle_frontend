import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';
import type {
  ChatConversationDto,
  ChatHistoryPageDto,
  ChatMemberDto,
  ChatMessageDto,
} from './protocol';
import { withoutLocallyDeleted } from './deleted-messages';
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

/** 历史翻页:height 键集向前翻,页内升序;顺手灌进 store。 */
export async function loadChatHistory(
  conversationId: string,
  options: { beforeHeight?: number; limit?: number } = {},
): Promise<ChatHistoryPageDto> {
  const params = new URLSearchParams();
  if (options.beforeHeight !== undefined) {
    params.set('beforeHeight', String(options.beforeHeight));
  }
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = params.toString();
  const sameSession = sessionGate();
  const page = await apiClient<ChatHistoryPageDto>(
    `/chat/conversations/${conversationId}/messages${query ? `?${query}` : ''}`,
  );
  if (sameSession()) {
    useChatStore.getState().ingestMessages(conversationId, page.messages);
  }
  return page;
}

/** 单页 100 × 10 页:一次重连最多追 1000 条,再多交给翻页/下次重连。 */
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
    cursor = dto.nextAfterHeight;
  }
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
    params.set('date', options.date);
    params.set('tzOffsetMinutes', String(new Date().getTimezoneOffset()));
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

/** 全局搜索:跨本人全部会话搜文本(最新在前,扁平;会话展示由调用方补齐)。 */
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

/** 会话偏好:置顶/免打扰/隐藏。返回最新 DTO 并回写 store。 */
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
 * G-14 清空聊天记录:服务端写 per-viewer 水位(对端不受影响),
 * 本地时间线/预览/未读同步清空 —— 不再是「清内存转头又拉回来」的假清空。
 */
export async function clearChatConversationHistory(
  conversationId: string,
): Promise<void> {
  const sameSession = sessionGate();
  await apiClient(`/chat/conversations/${conversationId}/clear`, {
    method: 'POST',
  });
  if (sameSession()) {
    useChatStore.getState().clearConversationLocal(conversationId);
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
