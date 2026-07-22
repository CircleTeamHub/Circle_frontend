import { storage } from '@/storage';
import { markGiftCardSent } from '@/services/api/coin';

/**
 * gift-card-ack.ts — 转账卡片回执的持久化重试队列（round 2 review）
 *
 * markGiftCardSent 是阻止后端补偿 cron 重发卡片的**唯一**信号：卡片发送
 * 成功但回执丢失（超时 / 退后台 / 瞬断）时，收款方稍后会看到第二张同構
 * 卡片。fire-and-forget 不够 —— 回执必须挂账重试直到后端收下。
 *
 * 设计：
 * - MMKV 持久化 key 列表（app 被杀也不丢账）；
 * - 发卡成功即入账，回执成功才销账；
 * - flushPendingGiftCardAcks 逐 key 尽力而为：成功销账，失败留待下次
 *   （聊天页 mount / 下一次发卡后都会再冲一次）；
 * - 后端 markGiftCardSent 幂等（按 idempotencyKey 置位），重复回执无害。
 */
const PENDING_ACKS_KEY = 'circle-im-gift-card-pending-acks';
const MAX_TRACKED_ACKS = 100;

function readPending(): string[] {
  try {
    const raw = storage.getString(PENDING_ACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function writePending(keys: string[]): void {
  try {
    // 防御性上限：正常情况下这里最多几条；异常堆积时保最新。
    storage.set(PENDING_ACKS_KEY, JSON.stringify(keys.slice(-MAX_TRACKED_ACKS)));
  } catch {
    // 存储失败退化回 fire-and-forget 语义（最坏 = 服务端多补一张同構卡片）
  }
}

/** 发卡成功后立即入账 —— 回执在 flush 里发出。 */
export function enqueueGiftCardAck(idempotencyKey: string): void {
  const pending = readPending();
  if (!pending.includes(idempotencyKey)) {
    writePending([...pending, idempotencyKey]);
  }
}

let flushInFlight = false;

/** 尽力冲销挂账回执；失败的 key 留待下次。并发调用合并。 */
export async function flushPendingGiftCardAcks(): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    const pending = readPending();
    for (const key of pending) {
      try {
        await markGiftCardSent(key);
        writePending(readPending().filter((item) => item !== key));
      } catch {
        // 网络/服务端瞬断：保留挂账，下次 flush 再试
      }
    }
  } finally {
    flushInFlight = false;
  }
}
