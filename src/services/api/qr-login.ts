import { apiClient } from './client';

/**
 * 网页扫码登录（与后端 src/auth/qr-login.service.ts 对齐）。
 *
 * 双令牌：qrToken 编进二维码给手机扫，pollKey 只留在本网页 —— 轮询换会话
 * 两个都要，旁观者拍到二维码也换不走登录态。
 */
export type QrLoginSession = {
  qrToken: string;
  pollKey: string;
  expiresAt: string;
};

export type QrLoginPollResult =
  | { status: 'PENDING' | 'EXPIRED' }
  | {
      status: 'APPROVED';
      tokens: { accessToken: string; refreshToken: string };
    };

export function createQrLoginSession(): Promise<QrLoginSession> {
  return apiClient<QrLoginSession>('/auth/qr-login', { method: 'POST' });
}

export function pollQrLoginStatus(
  qrToken: string,
  pollKey: string,
): Promise<QrLoginPollResult> {
  return apiClient<QrLoginPollResult>(
    `/auth/qr-login/${encodeURIComponent(qrToken)}?key=${encodeURIComponent(pollKey)}`,
  );
}

/** 手机端扫码后的确认（需要已登录会话）。 */
export function approveQrLogin(qrToken: string): Promise<{ ok: boolean }> {
  return apiClient<{ ok: boolean }>(
    `/auth/qr-login/${encodeURIComponent(qrToken)}/approve`,
    { method: 'POST', body: {} },
  );
}
