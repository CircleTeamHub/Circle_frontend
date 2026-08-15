import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { loadImagePickerModule } from '@/features/profile/image-picker';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { setCircleAvatar } from '@/services/api/circles';

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

interface UseChangeCircleAvatarResult {
  changeAvatar: () => Promise<void>;
  changing: boolean;
}

/**
 * 更换圈子头像：相册选图（方形）→ 上传 avatars → POST /circle/:id/avatar → 回写详情页。
 * 仅圈主可用（后端 assertOwner）。与封面 useChangeCircleCover 同构，只是落库走头像端点、裁剪为 1:1。
 */
export function useChangeCircleAvatar(
  circleId: string,
  onChanged: (avatarUrl: string) => void,
): UseChangeCircleAvatarResult {
  const { t } = useTranslation();
  const [changing, setChanging] = useState(false);
  const inFlightRef = useRef(false);

  const changeAvatar = useCallback(async () => {
    if (inFlightRef.current || changing) return;
    inFlightRef.current = true;
    try {
      const imagePicker = loadImagePickerModule();
      if (!imagePicker) {
        Alert.alert(
          t('validation.cannotSelectImage'),
          t('validation.imagePickerNotAvailable'),
        );
        return;
      }

      const permission =
        await imagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          t('validation.cannotSelectImage'),
          t('validation.albumPermission'),
        );
        return;
      }

      const result = await imagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        mediaTypes: ['images'],
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const contentType = resolveUploadContentType({
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      });
      if (!contentType) {
        Alert.alert(
          t('validation.cannotSelectImage'),
          t('validation.unsupportedImageFormat'),
        );
        return;
      }

      if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
        Alert.alert(
          t('validation.imageTooLarge'),
          t('validation.imageSizeLimit'),
        );
        return;
      }

      setChanging(true);
      try {
        const filename = sanitizeUploadFilename(asset.fileName ?? 'avatar.jpg');
        const { uploadUrl, fileUrl, requiredHeaders } = await requestUploadPresign({
          filename,
          contentType,
          folder: 'avatars',
          fileUri: asset.uri,
        });
        await uploadLocalFileToPresignedUrl(
          uploadUrl,
          contentType,
          asset.uri,
          requiredHeaders,
        );
        await setCircleAvatar(circleId, fileUrl);
        onChanged(fileUrl);
      } catch (error) {
        if (__DEV__) {
          console.warn('[useChangeCircleAvatar] avatar update failed', error);
        }
        Alert.alert(
          t('circle.avatarUpdateFailed', { defaultValue: '头像更新失败' }),
          t('common.networkError'),
        );
      } finally {
        setChanging(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [changing, circleId, onChanged, t]);

  return { changeAvatar, changing };
}
