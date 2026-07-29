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

function isProduct(value: unknown): value is GroupExpansionProduct {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isPositiveInteger(value.seats) &&
    isPositiveInteger(value.price) &&
    typeof value.purchasable === 'boolean' &&
    (value.unavailableReason === null ||
      value.unavailableReason === 'MAX_CAPACITY_EXCEEDED') &&
    isPositiveInteger(value.resultingMaxMembers)
  );
}

function isProductsResult(
  value: unknown,
): value is GroupExpansionProductsResult {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.circleId) &&
    isNonNegativeInteger(value.memberCount) &&
    isPositiveInteger(value.currentMaxMembers) &&
    isNonNegativeInteger(value.expansionSeats) &&
    isPositiveInteger(value.hardLimit) &&
    value.currentMaxMembers <= value.hardLimit &&
    Array.isArray(value.products) &&
    value.products.every(isProduct)
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
  return expectShape(raw, isProductsResult, invalidResponseMessage());
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
  return expectShape(raw, isPurchaseResult, invalidResponseMessage());
}
