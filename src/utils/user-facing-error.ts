/**
 * message 本身就是写给用户看的错误。
 *
 * getApiErrorMessage 对普通 Error 一律回落调用方 fallback —— 「Failed to fetch」
 * 「websocket error」这类底层文本绝不上屏。但有些业务 throw 的文案承载真实语义
 * (如「资料已提交，但刷新用户信息失败」:提交其实成功了,换成通用「保存失败」
 * 反而误导用户),这类 throw 用本类显式标记,漏斗才放行。
 *
 * 用 name 而非仅 instanceof 判定,与 StorageUploadError / TempChatUnavailableError
 * 在 send-errors 里的既有惯例一致(metro/jest 多副本场景下 instanceof 可能失灵)。
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function isUserFacingError(error: unknown): error is UserFacingError {
  return error instanceof Error && error.name === 'UserFacingError';
}
