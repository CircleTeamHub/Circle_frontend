import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency-key';
import {
  expectShape,
  isFiniteNonNegativeNumber,
  isNonEmptyString,
  isPlainObject,
} from '@/utils/validate';

export type GroupExpansionProduct = {
  id: string;
  name: string;
  seats: number;
  price: number;
  purchasable: boolean;
  unavailableReason: 'MAX_CAPACITY_EXCEEDED' | null;
  resultingMaxMembers: number;
};

export type GroupExpansionProductsResult = {
  circleId: string;
  memberCount: number;
  currentMaxMembers: number;
  expansionSeats: number;
  hardLimit: number;
  products: GroupExpansionProduct[];
};

export type GroupExpansionPurchaseResult = {
  orderId: string;
  circleId: string;
  productId: string;
  productName: string;
  seats: number;
  price: number;
  previousMaxMembers: number;
  newMaxMembers: number;
  walletBalanceAfter: number;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    isFiniteNonNegativeNumber(value)
  );
}

function isProduct(
  value: unknown,
  currentMaxMembers: number,
  hardLimit: number,
): value is GroupExpansionProduct {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isPositiveInteger(value.seats) &&
    isPositiveInteger(value.price) &&
    typeof value.purchasable === 'boolean' &&
    (value.unavailableReason === null ||
      value.unavailableReason === 'MAX_CAPACITY_EXCEEDED') &&
    isPositiveInteger(value.resultingMaxMembers) &&
    (value.purchasable
      ? value.unavailableReason === null &&
        value.resultingMaxMembers === currentMaxMembers + value.seats &&
        value.resultingMaxMembers <= hardLimit
      : value.unavailableReason === 'MAX_CAPACITY_EXCEEDED' &&
        value.resultingMaxMembers === currentMaxMembers + value.seats &&
        value.resultingMaxMembers > hardLimit)
  );
}

function isProductsResult(
  value: unknown,
): value is GroupExpansionProductsResult {
  if (
    !isPlainObject(value) ||
    !isNonEmptyString(value.circleId) ||
    !isNonNegativeInteger(value.memberCount) ||
    !isPositiveInteger(value.currentMaxMembers) ||
    !isNonNegativeInteger(value.expansionSeats) ||
    !isPositiveInteger(value.hardLimit) ||
    !Array.isArray(value.products)
  ) {
    return false;
  }

  const hardLimit = value.hardLimit;
  const currentMaxMembers = value.currentMaxMembers;
  return (
    currentMaxMembers <= hardLimit &&
    value.products.every((product) =>
      isProduct(product, currentMaxMembers, hardLimit),
    )
  );
}

function isPurchaseResult(
  value: unknown,
): value is GroupExpansionPurchaseResult {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.orderId) &&
    isNonEmptyString(value.circleId) &&
    isNonEmptyString(value.productId) &&
    isNonEmptyString(value.productName) &&
    isPositiveInteger(value.seats) &&
    isPositiveInteger(value.price) &&
    isPositiveInteger(value.previousMaxMembers) &&
    isPositiveInteger(value.newMaxMembers) &&
    value.newMaxMembers > value.previousMaxMembers &&
    isNonNegativeInteger(value.walletBalanceAfter)
  );
}

function invalidResponseMessage(): string {
  return i18n.t('common.errors.invalidServerResponse', {
    defaultValue: '服务返回了无效数据',
  });
}

export async function fetchGroupExpansionProducts(
  circleId: string,
): Promise<GroupExpansionProductsResult> {
  const raw = await apiClient<unknown>(
    `/group-expansions/products?circleId=${encodeURIComponent(circleId)}`,
  );
  const result = expectShape(raw, isProductsResult, invalidResponseMessage());
  if (result.circleId !== circleId) {
    throw new Error(invalidResponseMessage());
  }
  return result;
}

export async function purchaseGroupExpansion(
  circleId: string,
  productId: string,
  options?: { idempotencyKey?: string },
): Promise<GroupExpansionPurchaseResult> {
  const raw = await apiClient<unknown>('/group-expansions/purchases', {
    method: 'POST',
    body: { circleId, productId },
    headers: {
      'Idempotency-Key':
        options?.idempotencyKey ?? generateIdempotencyKey(),
    },
  });
  const result = expectShape(raw, isPurchaseResult, invalidResponseMessage());
  if (
    result.circleId !== circleId ||
    result.productId !== productId ||
    result.newMaxMembers !== result.previousMaxMembers + result.seats
  ) {
    throw new Error(invalidResponseMessage());
  }
  return result;
}
