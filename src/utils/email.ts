/**
 * email.ts — 前端邮箱校验/归一化的单一来源。
 *
 * 之前这个正则被复制在 use-auth.ts、LoginScreen、RegisterScreen 三处，
 * 任何一处改了都会与其它处漂移。集中到这里，校验口径全应用一致。
 *
 * 注意：这是「足够好」的格式预校验，不替代后端真实校验（发信成败才是权威）。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 宽松邮箱格式校验。内部先 trim，调用方传入是否已 trim 都安全（幂等）。 */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** 提交/发码前的归一化：去空格 + 转小写，避免大小写造成的「同邮箱不同账号」。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
