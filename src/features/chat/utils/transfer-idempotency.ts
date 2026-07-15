import { generateIdempotencyKey } from '@/utils/idempotency-key';

export type TransferIntent = {
  recipientId: string;
  amount: number;
  message: string | null;
};

export type TransferIdempotency = {
  signature: string;
  key: string;
};

export function resolveTransferIdempotency(
  current: TransferIdempotency | null,
  intent: TransferIntent,
): TransferIdempotency {
  const signature = JSON.stringify([
    intent.recipientId,
    intent.amount,
    intent.message ?? '',
  ]);
  if (current?.signature === signature) return current;
  return { signature, key: generateIdempotencyKey() };
}
