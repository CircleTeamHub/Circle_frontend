import { apiClient } from './client';
import { expectShape, isNonEmptyString, isPlainObject } from '@/utils/validate';

/** 与后端 src/qr/qr.types.ts 对齐。 */
export type QrTokenType = 'USER' | 'GROUP' | 'CIRCLE';

export type QrTokenResult = {
  token: string;
  type: QrTokenType;
  /** USER 名片码长效为 null;GROUP/CIRCLE 为 ISO 时间(7 天)。 */
  expiresAt: string | null;
};

export type QrViewerState = 'SELF' | 'ALREADY_IN' | 'FRIEND' | 'NONE';

export type QrResolveResult = {
  type: QrTokenType;
  targetId: string;
  name: string;
  avatarUrl: string | null;
  memberCount: number | null;
  issuerNickname: string;
  expiresAt: string | null;
  viewerState: QrViewerState;
};

export type QrJoinResult = {
  type: QrTokenType;
  conversationId?: string;
  circleId?: string;
  status: 'JOINED' | 'PENDING';
};

const QR_TOKEN_TYPES = new Set<QrTokenType>(['USER', 'GROUP', 'CIRCLE']);
const QR_VIEWER_STATES = new Set<QrViewerState>([
  'SELF',
  'ALREADY_IN',
  'FRIEND',
  'NONE',
]);

function isNullableDate(value: unknown): value is string | null {
  return value === null ||
    (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function isQrTokenResult(value: unknown): value is QrTokenResult {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.token) &&
    typeof value.type === 'string' &&
    QR_TOKEN_TYPES.has(value.type as QrTokenType) &&
    isNullableDate(value.expiresAt)
  );
}

function isQrResolveResult(value: unknown): value is QrResolveResult {
  return (
    isPlainObject(value) &&
    typeof value.type === 'string' &&
    QR_TOKEN_TYPES.has(value.type as QrTokenType) &&
    isNonEmptyString(value.targetId) &&
    typeof value.name === 'string' &&
    (value.avatarUrl === null || typeof value.avatarUrl === 'string') &&
    (value.memberCount === null ||
      (typeof value.memberCount === 'number' && Number.isInteger(value.memberCount) && value.memberCount >= 0)) &&
    typeof value.issuerNickname === 'string' &&
    isNullableDate(value.expiresAt) &&
    typeof value.viewerState === 'string' &&
    QR_VIEWER_STATES.has(value.viewerState as QrViewerState)
  );
}

function isQrJoinResult(value: unknown): value is QrJoinResult {
  return (
    isPlainObject(value) &&
    typeof value.type === 'string' &&
    QR_TOKEN_TYPES.has(value.type as QrTokenType) &&
    (value.status === 'JOINED' || value.status === 'PENDING') &&
    (value.conversationId === undefined || typeof value.conversationId === 'string') &&
    (value.circleId === undefined || typeof value.circleId === 'string')
  );
}

export function issueQrToken(input: {
  type: QrTokenType;
  targetId?: string;
}): Promise<QrTokenResult> {
  return apiClient<unknown>('/qr/tokens', {
    method: 'POST',
    body: input,
  }).then((raw) => expectShape(raw, isQrTokenResult, '二维码数据格式异常'));
}

export function rotateUserQrToken(): Promise<QrTokenResult> {
  return apiClient<unknown>('/qr/tokens/rotate', {
    method: 'POST',
    body: { type: 'USER' },
  }).then((raw) => expectShape(raw, isQrTokenResult, '二维码数据格式异常'));
}

export function resolveQrToken(token: string): Promise<QrResolveResult> {
  return apiClient<unknown>(`/qr/tokens/${encodeURIComponent(token)}`).then(
    (raw) => expectShape(raw, isQrResolveResult, '二维码预览数据格式异常'),
  );
}

export function joinByQrToken(token: string): Promise<QrJoinResult> {
  return apiClient<unknown>(
    `/qr/tokens/${encodeURIComponent(token)}/join`,
    { method: 'POST' },
  ).then((raw) => expectShape(raw, isQrJoinResult, '二维码加入结果格式异常'));
}
