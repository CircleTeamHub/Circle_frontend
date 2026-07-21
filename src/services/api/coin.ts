import { LIMITS } from '@/constants/config';
import { apiClient } from '@/services/api/client';
import i18n from '@/i18n';
import { generateIdempotencyKey } from '@/utils/idempotency-key';
import {
  expectShape,
  isFiniteNonNegativeNumber,
  isNonEmptyString,
  isPlainObject,
} from '@/utils/validate';

export type Wallet = {
  id: string;
  userID: string;
  balance: number;
  updatedAt: string;
};

// 钱涉及钱 —— 后端字段重命名 / 类型漂移会让前端用 NaN balance 渲染，最坏让用户基于
// undefined 余额发起交易。运行时守一道。
function isWalletShape(value: unknown): value is Wallet {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.userID) &&
    isFiniteNonNegativeNumber(value.balance) &&
    isNonEmptyString(value.updatedAt)
  );
}

export type CoinTransaction = {
  id: string;
  type: string;
  amount: number;
  balance: number;
  note: string | null;
  relatedID: string | null;
  createdAt: string;
};

export async function fetchWallet() {
  const raw = await apiClient<Wallet>('/coin/wallet');
  return expectShape(
    raw,
    isWalletShape,
    i18n.t('coin.errors.walletDataInvalid', { defaultValue: '钱包数据格式异常' }),
  );
}

export async function fetchCoinTransactions() {
  return apiClient<CoinTransaction[]>('/coin/transactions');
}

// 防御：积分必须为正整数。客户端 UI 已经在转账输入框约束 number-pad / replace(/[^0-9]/g)；
// 这里再守一次，捕获 hooks / 测试 / 脚本绕过 UI 直接调 API 的场景。后端仍是真理源。
function assertValidCoinAmount(amount: number): void {
  if (
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > LIMITS.TRANSFER_MAX_AMOUNT
  ) {
    throw new Error(
      i18n.t('coin.errors.invalidAmount', { defaultValue: '积分数量无效' }),
    );
  }
}

/**
 * #100：IM 转账卡片送达回执。凭 sendCoinGift 用过的同一枚 Idempotency-Key
 * 定位礼物；后端置位后补偿 cron 不再服务端补发卡片。
 */
export async function markGiftCardSent(idempotencyKey: string) {
  return apiClient<void>('/coin/gift/card-sent', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function sendCoinGift(
  payload: {
    recipientId: string;
    amount: number;
    message?: string;
  },
  options?: { idempotencyKey?: string },
) {
  assertValidCoinAmount(payload.amount);
  return apiClient<void>('/coin/gift', {
    method: 'POST',
    body: payload,
    headers: {
      'Idempotency-Key': options?.idempotencyKey ?? generateIdempotencyKey(),
    },
  });
}
