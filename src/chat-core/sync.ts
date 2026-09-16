import { reportHandledFailure } from '@/observability/report-failure';
import { fetchChatSyncPage, loadChatHistory } from './api';
import {
  applyLocalSyncPage,
  initChatLocalDb,
  readLocalSyncStates,
  redactLocalQuotesOf,
  resetLocalConversationCache,
  writeLocalSyncRevision,
} from './local-db';
import type { ChatConversationDto } from './protocol';
import { useChatStore } from './store';
import {
  advanceRevisionCursor,
  orderSyncTargets,
  planConversationSync,
} from './sync-plan';

/**
 * 会话变更序号流的客户端(与 circle_be GET /chat/conversations/:id/sync 配套)。
 *
 * 服务端给每次客户端可见的变更(新消息、撤回、编辑、表情回应、焚毁墓碑)分配一个
 * 会话内单调递增的 revision。本模块给每个会话记一个「已经追平到哪」的游标:
 * - 连上/重连时拿会话快照里的 syncRevision 比一遍,只追落后的会话 —— 不用打开
 *   会话,离线期间的撤回/焚毁也会落到本地缓存里;
 * - 在线时实时事件带着 revision,连续的才推进游标;出现缺口(漏了事件、或两个
 *   并发提交的广播到达顺序反了)等一小会儿再补拉那一段。
 *
 * 取代原来按时间戳追撤回/编辑的 mutations 通道:序号在服务端会话行锁下分配、与
 * 变更同事务提交,不存在「早时间戳、晚提交」被游标越过的行。
 */

/** 全局同时在跑的会话同步数:单会话串行、全局最多 4 个(squady 同款)。 */
const MAX_CONCURRENT_SYNCS = 4;
/** 一次追平最多翻几页(每页 200);翻不完留给下一次,游标已经持久化。 */
const SYNC_PAGES_MAX = 20;
/** 实时事件出现缺口后等这么久再补:两个并发提交的广播到达顺序可能相反。 */
const GAP_SYNC_DELAY_MS = 1_500;
/** 实时推进的游标攒一会儿再落盘:群里一阵消息不必逐条写一次本地库。 */
const CURSOR_PERSIST_DELAY_MS = 1_000;

interface ConversationCursor {
  revision: number;
  /** 已经收到、但前面还有缺口没补上的序号。 */
  pendingAbove: Set<number>;
  /** 本地库里有这个会话的消息(需要对账)。 */
  hasMessages: boolean;
}

let generation = 0;
let sessionUserId: string | null = null;
let cursorsLoading: Promise<void> | null = null;
let cursorsReady = false;
const cursors = new Map<string, ConversationCursor>();
const flights = new Map<string, Promise<void>>();
let runningSyncs = 0;
const slotWaiters: (() => void)[] = [];
const gapTimers = new Map<string, ReturnType<typeof setTimeout>>();
const gapTargets = new Map<string, number>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
let conversationResetHandler: ((conversationId: string) => void) | null = null;

/**
 * 一个会话的本地缓存被整体作废(跳到最新 / 服务端要求重建)时通知聊天页那一层:
 * 它记着向前翻页的游标,不复位的话往上翻会从作废之前的位置接着翻。
 */
export function setConversationCacheResetHandler(
  handler: ((conversationId: string) => void) | null,
): void {
  conversationResetHandler = handler;
}

/** 登录/切号:同一账号重复调用是 no-op(token 轮换不该丢掉游标)。 */
export function startChatSync(userId: string): void {
  if (sessionUserId === userId) return;
  resetChatSync();
  sessionUserId = userId;
}

/** 登出/切号:在途的同步一律作废,游标与定时器全部丢掉。 */
export function resetChatSync(): void {
  generation += 1;
  sessionUserId = null;
  cursorsLoading = null;
  cursorsReady = false;
  cursors.clear();
  flights.clear();
  for (const timer of gapTimers.values()) clearTimeout(timer);
  gapTimers.clear();
  gapTargets.clear();
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
}

function isCurrent(gen: number): boolean {
  return gen === generation && sessionUserId !== null;
}

function hasMemoryMessages(conversationId: string): boolean {
  return (
    useChatStore
      .getState()
      .messagesByConversation[conversationId]?.some((m) => m.height > 0) ??
    false
  );
}

function cursorFor(conversationId: string): ConversationCursor {
  const existing = cursors.get(conversationId);
  if (existing) return existing;
  const created: ConversationCursor = {
    revision: 0,
    pendingAbove: new Set(),
    hasMessages: false,
  };
  cursors.set(conversationId, created);
  return created;
}

/** 本地库里记着的游标只读一次;本地库不可用(Web / 没有 SQLCipher)时只有内存游标。 */
async function ensureCursorsLoaded(gen: number): Promise<void> {
  const userId = sessionUserId;
  if (!userId) return;
  cursorsLoading ??= (async () => {
    // 必须等本地库打开:游标读早了会以为「本地没有缓存」,于是跳过对账直接采纳
    // 服务端位置 —— 缓存里那些离线期间被撤回的原文就永远留着了。
    await initChatLocalDb(userId);
    const states = await readLocalSyncStates();
    if (gen !== generation) return;
    for (const [conversationId, state] of states ?? []) {
      const cursor = cursorFor(conversationId);
      if (state.revision > cursor.revision) cursor.revision = state.revision;
      cursor.hasMessages = cursor.hasMessages || state.hasMessages;
    }
    cursorsReady = true;
  })();
  await cursorsLoading;
}

/**
 * 槽位直接交接给下一个等待者,而不是先还再抢:先还的话,等待者的续体还没跑到时
 * 新来的任务会看见空槽直接开跑,并发数就短暂超过上限。
 */
async function withSyncSlot<T>(task: () => Promise<T>): Promise<T> {
  if (runningSyncs >= MAX_CONCURRENT_SYNCS) {
    await new Promise<void>((resolve) => slotWaiters.push(resolve));
  } else {
    runningSyncs += 1;
  }
  try {
    return await task();
  } finally {
    const next = slotWaiters.shift();
    if (next) next();
    else runningSyncs -= 1;
  }
}

function schedulePersist(conversationId: string, gen: number): void {
  if (persistTimers.has(conversationId)) return;
  const timer = setTimeout(() => {
    persistTimers.delete(conversationId);
    if (!isCurrent(gen)) return;
    const cursor = cursors.get(conversationId);
    if (cursor) void writeLocalSyncRevision(conversationId, cursor.revision);
  }, CURSOR_PERSIST_DELAY_MS);
  persistTimers.set(conversationId, timer);
}

/** 把游标推到 revision(不后退),顺带吃掉已经连上的缓存序号。 */
function advanceCursorTo(conversationId: string, revision: number): void {
  const cursor = cursorFor(conversationId);
  if (revision > cursor.revision) cursor.revision = revision;
  for (const pending of [...cursor.pendingAbove]) {
    if (pending <= cursor.revision) cursor.pendingAbove.delete(pending);
  }
  while (cursor.pendingAbove.has(cursor.revision + 1)) {
    cursor.revision += 1;
    cursor.pendingAbove.delete(cursor.revision);
  }
}

/** 丢掉一个会话的缓存,游标直接设到 revision。 */
async function resetConversationCache(
  conversationId: string,
  revision: number,
  gen: number,
): Promise<void> {
  useChatStore.getState().evictConversationCache(conversationId);
  await resetLocalConversationCache(conversationId, revision);
  if (!isCurrent(gen)) return;
  cursors.set(conversationId, {
    revision,
    pendingAbove: new Set(),
    hasMessages: false,
  });
  if (conversationResetHandler) {
    // 聊天页那一层接管:复位向前翻页的游标,正开着的会话按最新一页重拉。
    conversationResetHandler(conversationId);
    return;
  }
  if (useChatStore.getState().activeConversationId === conversationId) {
    // 正开着的会话不能就这么空着:按最新一页重拉(更早的往上翻时再拉)。
    await loadChatHistory(conversationId).catch((error: unknown) =>
      reportHandledFailure('chatSync', 'resetReload', error),
    );
  }
}

async function pullUntil(
  conversationId: string,
  target: number,
  gen: number,
): Promise<void> {
  for (let page = 0; page < SYNC_PAGES_MAX; page += 1) {
    if (!isCurrent(gen)) return;
    const before = cursorFor(conversationId).revision;
    if (before >= target) return;
    const result = await fetchChatSyncPage(conversationId, before);
    if (!result || !isCurrent(gen)) return;
    if (result.resetRequired) {
      await resetConversationCache(conversationId, result.throughRevision, gen);
      return;
    }
    useChatStore.getState().applySyncPage(conversationId, result);
    const tombstoneIds = result.messages
      .filter((m) => m.deleted === true)
      .map((m) => m.id);
    const live = result.messages.filter((m) => m.deleted !== true);
    // 游标跟它覆盖的变更一起提交;失败(或本地库不可用)时只推进内存游标,
    // 持久化游标留在原地,下次冷启动重新追这一段(应用是幂等的)。
    await applyLocalSyncPage(conversationId, {
      upserts: live,
      deletedIds: tombstoneIds,
      clearedBeforeHeight: result.clearedBeforeHeight,
      revision: result.nextRevision,
    });
    const revokedIds = live.filter((m) => m.revokedAt).map((m) => m.id);
    if (tombstoneIds.length > 0) {
      void redactLocalQuotesOf(conversationId, tombstoneIds, 'gone');
    }
    if (revokedIds.length > 0) {
      void redactLocalQuotesOf(conversationId, revokedIds, 'revoked');
    }
    if (!isCurrent(gen)) return;
    advanceCursorTo(conversationId, result.nextRevision);
    cursorFor(conversationId).hasMessages = true;
    if (!result.hasMore) return;
    // 游标不前进就是原地打转,继续追只会死循环。
    if (result.nextRevision <= before) return;
  }
}

async function syncConversation(
  conversationId: string,
  target: number,
  gen: number,
): Promise<void> {
  if (!isCurrent(gen)) return;
  const cursor = cursorFor(conversationId);
  const plan = planConversationSync({
    localRevision: cursor.revision,
    targetRevision: target,
    hasLocalMessages: cursor.hasMessages || hasMemoryMessages(conversationId),
  });
  switch (plan.kind) {
    case 'up-to-date':
      return;
    case 'adopt':
      advanceCursorTo(conversationId, plan.revision);
      schedulePersist(conversationId, gen);
      return;
    case 'jump':
      await resetConversationCache(conversationId, plan.revision, gen);
      return;
    case 'pull':
      await pullUntil(conversationId, plan.to, gen);
      return;
  }
}

function scheduleConversationSync(
  conversationId: string,
  target: number,
  gen: number,
): Promise<void> {
  const previous = flights.get(conversationId) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(() => withSyncSlot(() => syncConversation(conversationId, target, gen)));
  flights.set(conversationId, run);
  const settled = run.catch((error: unknown) =>
    reportHandledFailure('chatSync', 'conversationSync', error),
  );
  void settled.then(() => {
    if (flights.get(conversationId) === run) flights.delete(conversationId);
  });
  return settled;
}

/**
 * 连上/重连后按会话快照对账:本地游标落后于 syncRevision 的会话逐个追平,
 * 当前打开的会话优先。快照请求失败时调用方不用调这里,下一次连接再来。
 */
export async function syncConversationsFromSnapshot(
  conversations: readonly ChatConversationDto[],
  options: { prioritize?: string | null } = {},
): Promise<void> {
  const gen = generation;
  if (!sessionUserId) return;
  await ensureCursorsLoaded(gen);
  if (!isCurrent(gen)) return;
  const local = new Map<string, number>();
  for (const [conversationId, cursor] of cursors) {
    local.set(conversationId, cursor.revision);
  }
  const targets = orderSyncTargets(
    conversations,
    local,
    options.prioritize ?? null,
  );
  await Promise.all(
    targets.map(({ id, target }) => scheduleConversationSync(id, target, gen)),
  );
}

function scheduleGapSync(conversationId: string, target: number, gen: number): void {
  gapTargets.set(
    conversationId,
    Math.max(target, gapTargets.get(conversationId) ?? 0),
  );
  if (gapTimers.has(conversationId)) return;
  const timer = setTimeout(() => {
    gapTimers.delete(conversationId);
    const wanted = gapTargets.get(conversationId) ?? 0;
    gapTargets.delete(conversationId);
    if (!isCurrent(gen)) return;
    if (cursorFor(conversationId).revision >= wanted) return;
    void scheduleConversationSync(conversationId, wanted, gen);
  }, GAP_SYNC_DELAY_MS);
  gapTimers.set(conversationId, timer);
}

/**
 * 实时事件已经应用到 store 之后调用:revision 与游标连续就推进,出现缺口就排一次补拉。
 * 游标还没从本地库读出来(冷启动头几秒)的事件不算数 —— 连接时的快照同步会覆盖它们。
 */
export function noteLiveRevision(
  conversationId: string,
  revision: number | undefined,
): void {
  if (!sessionUserId || !cursorsReady) return;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0) {
    return;
  }
  const gen = generation;
  const cursor = cursorFor(conversationId);
  const step = advanceRevisionCursor(cursor.revision, cursor.pendingAbove, revision);
  cursor.pendingAbove = step.pendingAbove;
  cursor.hasMessages = true;
  if (step.cursor !== cursor.revision) {
    cursor.revision = step.cursor;
    schedulePersist(conversationId, gen);
  }
  if (step.gap) {
    scheduleGapSync(conversationId, Math.max(...step.pendingAbove), gen);
  }
}
