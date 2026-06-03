import i18n from '@/i18n';

type PermissionLike = {
  granted: boolean;
  canAskAgain?: boolean;
};

// 之前是 `export const AVATAR_PICKER_HELPER_TEXT = i18n.t(...)` —— 模块加载时执行一次，
// 用户切换语言后这个字符串不会跟着变。改成函数，每次调用拿当时的 locale。
export function getAvatarPickerHelperText(): string {
  return i18n.t('profileFields.avatarPickerHelper');
}

export function getAvatarPickerPermissionDeniedMessage(
  permission: PermissionLike,
) {
  if (permission.granted) {
    return null;
  }

  if (permission.canAskAgain === false) {
    return i18n.t('profileFields.albumPermissionBlocked');
  }

  return i18n.t('validation.albumPermission');
}
