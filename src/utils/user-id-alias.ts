/**
 * 旧 OpenIM 用户 id 形态(去连字符的 32 位 hex)归一回标准 UUID。
 * 深链/历史路由参数可能仍携带旧形态;标准 UUID 与其它输入原样返回。
 * 与后端 src/user/user-id-alias.ts 同契约。
 */
const DASHLESS_UUID = /^[0-9a-f]{32}$/i;

export function normalizeUserIdAlias(id: string): string {
  const trimmed = id.trim();
  if (!DASHLESS_UUID.test(trimmed)) {
    return trimmed;
  }
  const hex = trimmed.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
