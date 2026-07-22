import { AppState } from 'react-native';
import { storage } from '@/storage';
import { markGiftCardSent } from '@/services/api/coin';
import { useAuthStore } from '@/stores/authStore';

/**
 * gift-card-ack.ts — 转账卡片回执的持久化重试队列（round 2/3 review）
 *
 * markGiftCardSent 是阻止后端补偿 cron 重发卡片的**唯一**信号：卡片发送
 * 成功但回执丢失（超时 / 退后台 / 瞬断）时，收款方稍后会看到第二张同構
 * 卡片。fire-and-forget 不够 —— 回执必须挂账重试直到后端收下。
 *
 * 设计：
 * - MMKV 持久化 {key, userId} 列表（app 被杀也不丢账；round 3：按用户隔离，
 *   换号后别人的挂账不会用错会话冲销，也不会永久悬挂）；
 * - 发卡成功即入账，回执成功才销账；
 * - flush 触发面（round 3）：入账后立即 + 失败后 30s 延时重试 + 回前台 +
 *   聊天页 mount，覆盖「用户停在聊天页」的窗口；
 * - 后端 markGiftCardSent 幂等（按 idempotencyKey 置位），重复回执无害。
 */
const PENDING_ACKS_KEY = 'circle-im-gift-card-pending-acks';
const MAX_TRACKED_ACKS = 100;
const RETRY_DELAY_MS = 30_000;

type PendingAck = { key: string; userId: string };

function readPending(): PendingAck[] {
  try {
    const raw = storage.getString(PENDING_ACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): PendingAck | null => {
        if (typeof item === 'string') {
          // 旧格式（裸 key）：归当前用户（写入时的会话即它的会话）
          const userId = useAuthStore.getState().user?.id ?? '';
          return userId ? { key: item, userId } : null;
        }
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as PendingAck).key === 'string' &&
          typeof (item as PendingAck).userId === 'string'
        ) {
          return item as PendingAck;
        }
        return null;
      })
      .filter((item): item is PendingAck => item !== null);
  } catch {
    return [];
  }
}

function writePending(acks: PendingAck[]): void {
  try {
    // 防御性上限：正常情况下这里最多几条；异常堆积时保最新。
    storage.set(PENDING_ACKS_KEY, JSON.stringify(acks.slice(-MAX_TRACKED_ACKS)));
  } catch {
    // 存储失败退化回 fire-and-forget 语义（最坏 = 服务端多补一张同構卡片）
  }
}

/** 发卡成功后立即入账 —— 回执在 flush 里发出。 */
export function enqueueGiftCardAck(idempotencyKey: string): void {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const pending = readPending();
  if (!pending.some((item) => item.key === idempotencyKey)) {
    writePending([...pending, { key: idempotencyKey, userId }]);
  }
}

let flushInFlight = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let appStateHooked = false;

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushPendingGiftCardAcks();
  }, RETRY_DELAY_MS);
}

/** 回前台补冲（懒注册一次；用户停在聊天页时由延时重试兜底）。 */
function ensureAppStateHook(): void {
  if (appStateHooked) return;
  appStateHooked = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void flushPendingGiftCardAcks();
    }
  });
}

/** 尽力冲销当前用户的挂账回执；失败的留待延时/前台重试。并发调用合并。 */
export async function flushPendingGiftCardAcks(): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    ensureAppStateHook();
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    // round 3：只冲当前用户的账 —— 回执是认证端点，用别人的会话发既发不对
    // 也会把原主的挂账永久冻住。
    const mine = readPending().filter((item) => item.userId === userId);
    let anyFailed = false;
    for (const ack of mine) {
      try {
        await markGiftCardSent(ack.key);
        writePending(readPending().filter((item) => item.key !== ack.key));
      } catch {
        anyFailed = true;
      }
    }
    if (anyFailed) {
      // round 3：不再被动等外部触发 —— 30s 后自动重试（单枚定时器合并）
      scheduleRetry();
    }
  } finally {
    flushInFlight = false;
  }
}
