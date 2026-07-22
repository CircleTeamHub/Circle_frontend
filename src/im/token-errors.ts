/**
 * im/token-errors.ts — OpenIM 登录错误分类（纯函数，无 RN 依赖，可被 node:test 直测）
 *
 * 服务端 token 错误码族：1501 expired / 1502 invalid / 1503 malformed /
 * 1504 not-valid-yet / 1505 unknown / 1506 kicked。SDK 层拿到的形状不稳定
 * （code 字段或仅 message 文本），与 client.ts 里 10004/10102 的判定同风格做双通道匹配。
 */
const OPENIM_TOKEN_ERROR_CODE_MIN = 1501;
const OPENIM_TOKEN_ERROR_CODE_MAX = 1506;

/**
 * 「缓存的 imToken 已被服务端拒绝」——重试同一枚 token 没有意义，应改走
 * GET /auth/im-token 换新 token 再登（见 token-recovery.ts）。
 * 网络失败 / SDK 内部错误等其它失败返回 false，交给原样重试路径。
 */
export function isOpenIMTokenRejectedError(error: unknown): boolean {
  // RN SDK 的原生失败常用 errCode/errMsg（见 onConnectFailed 文档形状），
  // JS 层再包一层时才是 code/message —— 两对都查（review 修复：只查 code 时
  // `{ errCode: 1502 }` 会被 String() 成 '[object Object]'，判成瞬时失败后
  // 反复重试同一枚已被拒绝的 token）。
  const shaped = error as { code?: unknown; errCode?: unknown } | null;
  for (const code of [shaped?.code, shaped?.errCode]) {
    if (
      typeof code === 'number' &&
      code >= OPENIM_TOKEN_ERROR_CODE_MIN &&
      code <= OPENIM_TOKEN_ERROR_CODE_MAX
    ) {
      return true;
    }
  }

  const errMsg = (error as { errMsg?: unknown } | null)?.errMsg;
  const message = [
    error instanceof Error ? error.message : String(error ?? ''),
    typeof errMsg === 'string' ? errMsg : '',
  ].join(' ');
  if (/\b150[1-6]\b/.test(message)) {
    return true;
  }
  return /token\s*(is\s*)?(expired|invalid|malformed|kicked)/i.test(message);
}
