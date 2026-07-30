import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency-key';
import { expectShape, isFiniteNonNegativeNumber, isNonEmptyString, isPlainObject } from '@/utils/validate';

export type FancyNumberItem = {
  id: string;
  value: string;
};

export type FancyNumberList = {
  items: FancyNumberItem[];
  nextCursor: string | null;
  unitPrice: number;
  minMonths: number;
  maxMonths: number;
  purchaseMode: 'PAID_MONTHLY' | 'PERMANENT_FREE';
};

export type MyFancyNumber = {
  active: boolean;
  accountId: string | null;
  restoreAccountId: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  permanent: boolean;
  renewable: boolean;
  unitPrice: number;
};

export type FancyNumberPurchaseResult = {
  orderId: string;
  accountId: string;
  expiresAt: string | null;
  permanent: boolean;
  months: number | null;
  unitPrice: number;
  totalPrice: number;
  walletBalanceAfter: number;
};

export type FancyNumberAvailability = {
  value: string;
  available: boolean;
  reason: 'TAKEN' | 'RESERVED' | null;
};

const CUSTOM_FANCY_NUMBER_PATTERN = /^[A-Z0-9]{6}$/;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0;
}

function isValidDateString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isNullableValidDateString(value: unknown): value is string | null {
  return value === null || isValidDateString(value);
}

function isFancyNumberItem(value: unknown): value is FancyNumberItem {
  return isPlainObject(value) && isNonEmptyString(value.id) && isNonEmptyString(value.value);
}

function isFancyNumberList(value: unknown): value is FancyNumberList {
  return (
    isPlainObject(value) &&
    Array.isArray(value.items) &&
    value.items.every(isFancyNumberItem) &&
    isNullableString(value.nextCursor) &&
    isFiniteNonNegativeNumber(value.unitPrice) &&
    isPositiveInteger(value.minMonths) &&
    isPositiveInteger(value.maxMonths) &&
    value.minMonths <= 12 &&
    value.maxMonths <= 12 &&
    value.maxMonths >= value.minMonths &&
    (value.purchaseMode === 'PAID_MONTHLY' || value.purchaseMode === 'PERMANENT_FREE')
  );
}

function isMyFancyNumber(value: unknown): value is MyFancyNumber {
  return (
    isPlainObject(value) &&
    typeof value.active === 'boolean' &&
    isNullableString(value.accountId) &&
    isNullableString(value.restoreAccountId) &&
    isNullableValidDateString(value.startedAt) &&
    isNullableValidDateString(value.expiresAt) &&
    typeof value.permanent === 'boolean' &&
    typeof value.renewable === 'boolean' &&
    isFiniteNonNegativeNumber(value.unitPrice) &&
    (!value.active ||
      (isNonEmptyString(value.accountId) &&
        (value.permanent
          ? value.expiresAt === null
          : isValidDateString(value.expiresAt))))
  );
}

function isPurchaseResult(value: unknown): value is FancyNumberPurchaseResult {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.orderId) &&
    isNonEmptyString(value.accountId) &&
    isNullableValidDateString(value.expiresAt) &&
    typeof value.permanent === 'boolean' &&
    (value.months === null || isPositiveInteger(value.months)) &&
    (value.permanent
      ? value.expiresAt === null && value.months === null
      : isValidDateString(value.expiresAt) && isPositiveInteger(value.months)) &&
    isFiniteNonNegativeNumber(value.unitPrice) &&
    isFiniteNonNegativeNumber(value.totalPrice) &&
    isFiniteNonNegativeNumber(value.walletBalanceAfter)
  );
}

function isFancyNumberAvailability(
  value: unknown,
): value is FancyNumberAvailability {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.value) &&
    typeof value.available === 'boolean' &&
    (value.reason === null ||
      value.reason === 'TAKEN' ||
      value.reason === 'RESERVED') &&
    (value.available
      ? value.reason === null
      : value.reason === 'TAKEN' || value.reason === 'RESERVED')
  );
}

function invalidResponseMessage() {
  return i18n.t('common.errors.invalidServerResponse', {
    defaultValue: '服务返回了无效数据',
  });
}

function expectPurchaseIntent(
  raw: unknown,
  expected: {
    permanent: boolean;
    months: number | null;
    accountId?: string;
  },
): FancyNumberPurchaseResult {
  const result = expectShape(raw, isPurchaseResult, invalidResponseMessage());
  if (
    result.permanent !== expected.permanent ||
    result.months !== expected.months ||
    (expected.accountId !== undefined &&
      result.accountId !== expected.accountId)
  ) {
    throw new Error(invalidResponseMessage());
  }
  return result;
}

function assertMonths(months: number): void {
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    throw new Error(
      i18n.t('profile.fancyNumber.invalidMonths', {
        defaultValue: '购买时长必须为 1 到 12 个月',
      }),
    );
  }
}

function normalizeCustomValue(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!CUSTOM_FANCY_NUMBER_PATTERN.test(normalized)) {
    throw new Error(
      i18n.t('profile.fancyNumber.invalidCustomValue', {
        defaultValue: '靓号必须是 6 位英文字母或数字',
      }),
    );
  }
  return normalized;
}

export async function fetchFancyNumbers(options?: { cursor?: string; limit?: number }): Promise<FancyNumberList> {
  const params = new URLSearchParams();
  if (options?.cursor) params.set('cursor', options.cursor);
  if (options?.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  const raw = await apiClient<unknown>(`/mall/fancy-numbers${query ? `?${query}` : ''}`);
  return expectShape(raw, isFancyNumberList, invalidResponseMessage());
}

export async function fetchMyFancyNumber(): Promise<MyFancyNumber> {
  const raw = await apiClient<unknown>('/mall/fancy-numbers/me');
  return expectShape(raw, isMyFancyNumber, invalidResponseMessage());
}

export async function checkFancyNumberAvailability(
  value: string,
): Promise<FancyNumberAvailability> {
  const normalized = normalizeCustomValue(value);
  const raw = await apiClient<unknown>(
    `/mall/fancy-numbers/availability?value=${encodeURIComponent(normalized)}`,
  );
  const result = expectShape(
    raw,
    isFancyNumberAvailability,
    invalidResponseMessage(),
  );
  if (result.value !== normalized) {
    throw new Error(invalidResponseMessage());
  }
  return result;
}

export async function purchaseFancyNumber(
  id: string,
  payload: { months?: number },
  options?: { idempotencyKey?: string },
): Promise<FancyNumberPurchaseResult> {
  if (payload.months !== undefined) assertMonths(payload.months);
  const raw = await apiClient<unknown>(`/mall/fancy-numbers/${encodeURIComponent(id)}/purchase`, {
    method: 'POST',
    body: payload,
    headers: {
      'Idempotency-Key': options?.idempotencyKey ?? generateIdempotencyKey(),
    },
  });
  return expectPurchaseIntent(raw, {
    permanent: payload.months === undefined,
    months: payload.months ?? null,
  });
}

export async function renewFancyNumber(
  payload: { months: number },
  options?: { idempotencyKey?: string },
): Promise<FancyNumberPurchaseResult> {
  assertMonths(payload.months);
  const raw = await apiClient<unknown>('/mall/fancy-numbers/renew', {
    method: 'POST',
    body: payload,
    headers: {
      'Idempotency-Key': options?.idempotencyKey ?? generateIdempotencyKey(),
    },
  });
  return expectPurchaseIntent(raw, {
    permanent: false,
    months: payload.months,
  });
}

export async function switchPermanentFancyNumber(id: string, options?: { idempotencyKey?: string }): Promise<FancyNumberPurchaseResult> {
  const raw = await apiClient<unknown>(`/mall/fancy-numbers/${encodeURIComponent(id)}/switch`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': options?.idempotencyKey ?? generateIdempotencyKey(),
    },
  });
  return expectPurchaseIntent(raw, { permanent: true, months: null });
}

export async function purchaseCustomFancyNumber(
  payload: { value: string; months?: number },
  options?: { idempotencyKey?: string },
): Promise<FancyNumberPurchaseResult> {
  if (payload.months !== undefined) assertMonths(payload.months);
  const normalized = normalizeCustomValue(payload.value);
  const raw = await apiClient<unknown>('/mall/fancy-numbers/custom/purchase', {
    method: 'POST',
    body: {
      ...payload,
      value: normalized,
    },
    headers: {
      'Idempotency-Key':
        options?.idempotencyKey ?? generateIdempotencyKey(),
    },
  });
  return expectPurchaseIntent(raw, {
    permanent: payload.months === undefined,
    months: payload.months ?? null,
    accountId: normalized,
  });
}

export async function switchPermanentToCustomFancyNumber(
  payload: { value: string },
  options?: { idempotencyKey?: string },
): Promise<FancyNumberPurchaseResult> {
  const normalized = normalizeCustomValue(payload.value);
  const raw = await apiClient<unknown>('/mall/fancy-numbers/custom/switch', {
    method: 'POST',
    body: { value: normalized },
    headers: {
      'Idempotency-Key':
        options?.idempotencyKey ?? generateIdempotencyKey(),
    },
  });
  return expectPurchaseIntent(raw, {
    permanent: true,
    months: null,
    accountId: normalized,
  });
}
