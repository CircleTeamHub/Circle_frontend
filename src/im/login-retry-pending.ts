/**
 * im/login-retry-pending.ts — OpenIM 补登欠账（round 2 review）
 *
 * SessionBootstrap 原本用组件私有 ref 记「登录失败，回前台重试」；但欠账的
 * 生产者不止 bootstrap 自己 —— 降级切号（use-auth）在 clearLocalSession 已把
 * IM 登出、而 setSession 让 bootstrap 跳过启动补登的情况下，也需要把失败挂到
 * 同一份欠账上。提升为模块级标记，生产者 mark、bootstrap 回前台 consume。
 */
let pending = false;

export function markIMLoginRetryPending(): void {
  pending = true;
}

export function clearIMLoginRetryPending(): void {
  pending = false;
}

export function isIMLoginRetryPending(): boolean {
  return pending;
}
