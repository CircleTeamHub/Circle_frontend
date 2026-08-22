import { apiClient } from './client';

/** 与后端 src/qr/qr.types.ts 对齐。 */
export type QrTokenType = 'USER' | 'GROUP' | 'CIRCLE' | 'LOGIN';

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
  /** LOGIN 预览专用：帮助手机端核对发起登录的浏览器。 */
  requestDevice?: string;
  verificationCode?: string;
};

export type QrJoinResult = {
  type: QrTokenType;
  conversationId?: string;
  circleId?: string;
  status: 'JOINED' | 'PENDING';
};

export function issueQrToken(input: {
  // LOGIN 令牌由 /auth/qr-login 独立签发，不走本面。
  type: Exclude<QrTokenType, 'LOGIN'>;
  targetId?: string;
}): Promise<QrTokenResult> {
  return apiClient<QrTokenResult>('/qr/tokens', {
    method: 'POST',
    body: input,
  });
}

export function rotateUserQrToken(): Promise<QrTokenResult> {
  return apiClient<QrTokenResult>('/qr/tokens/rotate', {
    method: 'POST',
    body: { type: 'USER' },
  });
}

export function resolveQrToken(token: string): Promise<QrResolveResult> {
  return apiClient<QrResolveResult>(`/qr/tokens/${encodeURIComponent(token)}`);
}

export function joinByQrToken(token: string): Promise<QrJoinResult> {
  return apiClient<QrJoinResult>(
    `/qr/tokens/${encodeURIComponent(token)}/join`,
    { method: 'POST' },
  );
}
