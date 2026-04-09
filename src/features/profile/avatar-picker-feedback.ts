type PermissionLike = {
  granted: boolean;
  canAskAgain?: boolean;
};

export const AVATAR_PICKER_HELPER_TEXT =
  '从本地相册选择头像。首次会请求相册权限；如果模拟器相册为空，请先导入照片或改用真机。';

export function getAvatarPickerPermissionDeniedMessage(
  permission: PermissionLike,
) {
  if (permission.granted) {
    return null;
  }

  if (permission.canAskAgain === false) {
    return '相册权限已被关闭，请到系统设置中允许 Circle IM 访问相册后再试。';
  }

  return '请先允许访问相册。';
}
