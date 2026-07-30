/**
 * 持久化前清空敏感 PII。
 *
 * 应用级 MMKV 目前未加密（见 C-05 权衡：整库加密需异步取密钥 + 启动时序重构 + 真机验证，
 * 作为后续独立项），因此 email / 手机 / 社交号 / 生日 / 城市等联系与身份信息不应明文落盘。
 * 这些字段登录后由 /auth/me 回填到内存，所以仅从「持久化快照」中剔除即可——在线运行时
 * 体验不变。token 已单独保存在 SecureStore（Keychain）。
 */
export function sanitizeUserForPersist<T extends object | null>(user: T): T {
  if (!user) return user;
  const record = user as Record<string, unknown>;
  const appearance = record.avatarFrameAppearance;
  const sanitizedAppearance =
    appearance !== null &&
    typeof appearance === 'object' &&
    !Array.isArray(appearance)
      ? { ...appearance, imageUrl: null }
      : appearance;
  return {
    ...user,
    email: null,
    phoneNumber: null,
    wechat: null,
    qq: null,
    whatsup: null,
    persona: null,
    helloWords: null,
    birthday: null,
    city: null,
    ...('avatarFrame' in record ? { avatarFrame: null } : {}),
    ...('avatarFrameAppearance' in record
      ? { avatarFrameAppearance: sanitizedAppearance }
      : {}),
  } as T;
}
