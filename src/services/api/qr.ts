import { apiClient } from './client';

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

export function issueQrToken(input: {
  type: QrTokenType;
  targetId?: string;
}): Promise<QrTokenResult> {
  return apiClient<QrTokenResult>('/qr/tokens', {
    method: 'POST',
    body: input,
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
