import { storage } from '@/storage';
import { generateIdempotencyKey } from '@/utils/idempotency-key';

export type TransferIntent = {
  recipientId: string;
  amount: number;
  message: string | null;
};

type PendingTransfer = { signature: string; key: string; at: number };

/**
 * 转账的幂等键按「这一笔」落到加密存储,而不是只活在页面 ref 里:超时/5xx 之后
 * 钱可能已经划走,用户退出转账页再进来、甚至重启 App 再发同一笔(同收款人、同金额、
 * 同留言),必须还是同一个键,否则服务端把它当成第二笔再扣一次。
 *
 * 按账号分 key;24 小时后过期(过了一天还在重发同一笔,当成新的一笔)。
 * 只在成功或服务端明确拒绝时作废(settle),结果不明时一直留着。
 */
const PREFIX = 'circle-im-pending-transfers:v1:';
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function storageKey(userId: string): string {
  return `${PREFIX}${encodeURIComponent(userId)}`;
}

function readPending(userId: string, now: number): PendingTransfer[] {
  const raw = storage.getString(storageKey(userId));
  const entries: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(entries)) return [];
  return (entries as PendingTransfer[]).filter((entry) => now - entry.at < PENDING_TTL_MS);
}

function writePending(userId: string, entries: PendingTransfer[]): void {
  if (entries.length > 0) {
    storage.set(storageKey(userId), JSON.stringify(entries));
  } else {
    storage.remove(storageKey(userId));
  }
}

/** 这一笔的幂等键:同一笔还没结论就复用,否则新建并在请求发出前落盘。 */
export function resolveTransferIdempotencyKey(
  userId: string,
  intent: TransferIntent,
  now = Date.now(),
): string {
  const signature = JSON.stringify([
    intent.recipientId,
    intent.amount,
    intent.message ?? '',
  ]);
  const entries = readPending(userId, now);
  const pending = entries.find((entry) => entry.signature === signature);
  if (pending) return pending.key;
  const key = generateIdempotencyKey();
  writePending(userId, [...entries, { signature, key, at: now }]);
  return key;
}

/** 这一笔有了结论(成功,或服务端明确拒绝):再发就是新的一笔。 */
export function settleTransferIdempotencyKey(
  userId: string,
  key: string,
  now = Date.now(),
): void {
  writePending(
    userId,
    readPending(userId, now).filter((entry) => entry.key !== key),
  );
}
