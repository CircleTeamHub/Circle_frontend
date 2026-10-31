import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import {
  FRIEND_REPORT_CATEGORIES,
  type FriendReportCategory,
} from '@/services/api/friends';
import {
  expectShape,
  isFiniteNonNegativeNumber,
  isNonEmptyString,
  isPlainObject,
} from '@/utils/validate';

export type CreditEvent = {
  id: string;
  /** 带符号的变动分数，如 -5。 */
  delta: number;
  scoreAfter: number;
  /** 变动来源，如 FRIEND_REPORT；新来源上线前前端按「信誉值调整」兜底展示。 */
  reason: string;
  /** 来自好友举报时的举报分类；不认识的分类在入口处归为 null。 */
  category: FriendReportCategory | null;
  createdAt: string;
};

type RawCreditEvent = Omit<CreditEvent, 'category'> & { category: string | null };

function isRawCreditEvent(value: unknown): value is RawCreditEvent {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    typeof value.delta === 'number' &&
    Number.isInteger(value.delta) &&
    isFiniteNonNegativeNumber(value.scoreAfter) &&
    isNonEmptyString(value.reason) &&
    (value.category === null || typeof value.category === 'string') &&
    isNonEmptyString(value.createdAt) &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

function toKnownCategory(category: string | null): FriendReportCategory | null {
  return FRIEND_REPORT_CATEGORIES.find((known) => known === category) ?? null;
}

/** 当前用户最近的信誉值变动（服务端按时间倒序，最多 50 条）。 */
export async function fetchCreditEvents(): Promise<CreditEvent[]> {
  const raw = await apiClient<unknown>('/credit/events');
  const events = expectShape(
    raw,
    (value): value is RawCreditEvent[] =>
      Array.isArray(value) && value.every(isRawCreditEvent),
    i18n.t('credit.recentLoadFailed'),
  );
  return events.map((event) => ({ ...event, category: toKnownCategory(event.category) }));
}
