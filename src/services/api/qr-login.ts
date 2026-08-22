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

/**
 * 轮询走 POST，pollKey 放 body。曾经是 `GET ...?key=<pollKey>`：那把钥匙能直接
 * 换走 access/refresh 令牌，进了 URL 就会沿「开发日志 → 反代访问日志 → 异常
 * 上报的 request.url」一路留痕，捡到日志的人可以在用户确认后抢先兑换。
 * 顺带解决另一半：GET 是可缓存的，带令牌的那次响应可能被中间层留存重放。
 */
export function pollQrLoginStatus(
  qrToken: string,
  pollKey: string,
): Promise<QrLoginPollResult> {
  return apiClient<QrLoginPollResult>(
    `/auth/qr-login/${encodeURIComponent(qrToken)}/status`,
    { method: 'POST', body: { pollKey } },
  );
}

/** 手机端扫码后的确认（需要已登录会话）。 */
export function approveQrLogin(qrToken: string): Promise<{ ok: boolean }> {
  return apiClient<{ ok: boolean }>(
    `/auth/qr-login/${encodeURIComponent(qrToken)}/approve`,
    { method: 'POST', body: {} },
  );
}
