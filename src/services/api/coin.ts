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

function isCoinTransaction(value: unknown): value is CoinTransaction {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.type) &&
    typeof value.amount === 'number' &&
    Number.isInteger(value.amount) &&
    isFiniteNonNegativeNumber(value.balance) &&
    (value.note === null || typeof value.note === 'string') &&
    (value.relatedID === null || typeof value.relatedID === 'string') &&
    isNonEmptyString(value.createdAt) &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

export async function fetchWallet() {
  const raw = await apiClient<Wallet>('/coin/wallet');
  return expectShape(
    raw,
    isWalletShape,
    i18n.t('coin.errors.walletDataInvalid', { defaultValue: '钱包数据格式异常' }),
  );
}

export async function fetchCoinTransactions() {
  const raw = await apiClient<unknown>('/coin/transactions');
  return expectShape(
    raw,
    (value): value is CoinTransaction[] =>
      Array.isArray(value) && value.every(isCoinTransaction),
    i18n.t('coin.errors.transactionDataInvalid', {
      defaultValue: '积分流水数据格式异常',
    }),
  );
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
 * 转账。这里只负责把钱转掉 —— 转账卡片由后端在结算事务提交后就地签发并广播,
 * 客户端既不发卡、也不需要回执。
 *
 * (历史:曾有一个「卡片已送达」的回执端点与配套的 MMKV 挂账重试队列,前提是
 *  卡片由客户端发。而那条发送 100% 被服务端拒收,整套回执从未被执行过,已删。)
 */
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
