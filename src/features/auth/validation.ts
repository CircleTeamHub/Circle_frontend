/**
 * validation.ts — 认证表单的纯校验逻辑（无 React / 无 i18n 依赖）。
 *
 * 设计：每个校验器返回 **i18n key**（`auth.errors.*`）或 null（通过）。
 *  - 纯函数 → 可在无 React 环境直接单测（见 test/auth-validation.test.js）。
 *  - 由 hook 负责 `i18n.t(key)` 渲染，校验逻辑与文案/语言解耦。
 *
 * 边界对齐后端 DTO（circle_be/src/auth/dto）：
 *  - password: @Length(6, 64)
 *  - nickname: @Length(1, 50)
 *  - code:     @Length(6, 6)
 * 本地先挡一层，避免确定性输入也要往返一次拿 422。
 */
import { isValidEmail } from '@/utils/email';

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 64;
export const NICKNAME_MAX = 50;
export const CODE_LENGTH = 6;
export const INVITE_CODE_MIN = 4;
export const INVITE_CODE_MAX = 32;

const CODE_RE = new RegExp(`^\\d{${CODE_LENGTH}}$`);
const INVITE_CODE_RE = new RegExp(
  `^[a-zA-Z0-9_-]{${INVITE_CODE_MIN},${INVITE_CODE_MAX}}$`,
);

export type ValidationError = string | null;

export function validateEmail(email: string): ValidationError {
  const trimmed = email.trim();
  if (!trimmed) return 'auth.errors.emailRequired';
  if (!isValidEmail(trimmed)) return 'auth.errors.invalidEmail';
  return null;
}

export function validatePassword(password: string): ValidationError {
  // 密码不 trim：首尾空格是合法字符，长度按原样计。
  if (!password) return 'auth.errors.passwordRequired';
  if (password.length < PASSWORD_MIN) return 'auth.errors.passwordTooShort';
  if (password.length > PASSWORD_MAX) return 'auth.errors.passwordTooLong';
  return null;
}

export function validateCode(code: string): ValidationError {
  if (!CODE_RE.test(code.trim())) return 'auth.errors.invalidCode';
  return null;
}

export function validateNickname(nickname: string): ValidationError {
  const trimmed = nickname.trim();
  if (!trimmed) return 'auth.errors.nicknameRequired';
  if (trimmed.length > NICKNAME_MAX) return 'auth.errors.nicknameTooLong';
  return null;
}

export function validateInviteCode(inviteCode: string): ValidationError {
  const trimmed = inviteCode.trim();
  if (!trimmed) return null;
  if (!INVITE_CODE_RE.test(trimmed)) return 'auth.errors.invalidInviteCode';
  return null;
}

/** 复合校验：返回第一个未通过项的 key（?? 短路，顺序即展示优先级）。 */
export function validateLoginForm(email: string, password: string): ValidationError {
  return validateEmail(email) ?? validatePassword(password);
}

export function validateLoginCodeForm(email: string, code: string): ValidationError {
  return validateEmail(email) ?? validateCode(code);
}

export function validateRegisterForm(
  email: string,
  code: string,
  password: string,
  nickname: string,
  inviteCode = '',
): ValidationError {
  return (
    validateEmail(email) ??
    validateCode(code) ??
    validatePassword(password) ??
    validateNickname(nickname) ??
    validateInviteCode(inviteCode)
  );
}
