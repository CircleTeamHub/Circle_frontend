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
import { reportHandledFailure } from '@/observability/report-failure';

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

interface UseChangeGroupAvatarResult {
  changeAvatar: () => Promise<void>;
  changing: boolean;
}

/**
 * 更换群头像(独立群聊 / 圈子群共用):相册选图(方形)→ 上传 avatars → 交给
 * 调用方的 submit 落库(独立群 PATCH /chat/conversations/:id/avatar,圈子群
 * POST /circle/:id/avatar)。与 useChangeCircleAvatar 同构,只是把落库端点抽成参数。
 */
export function useChangeGroupAvatar(
  submit: (fileUrl: string) => Promise<void>,
  onChanged: (avatarUrl: string) => void,
): UseChangeGroupAvatarResult {
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
        await submit(fileUrl);
        onChanged(fileUrl);
      } catch (error) {
        reportHandledFailure('chatInfo', 'groupAvatarUpdate', error);
        Alert.alert(
          t('chat.groupAvatarUpdateFailed', { defaultValue: '群头像更新失败' }),
          t('common.networkError'),
        );
      } finally {
        setChanging(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [changing, onChanged, submit, t]);

  return { changeAvatar, changing };
}
