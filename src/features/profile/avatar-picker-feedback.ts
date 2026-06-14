import i18n from '@/i18n';

type PermissionLike = {
  granted: boolean;
  canAskAgain?: boolean;
};

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
