import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { loadImagePickerModule } from '@/features/profile/image-picker';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { updateUserProfile } from '@/services/api/profile';
import { useAuthStore } from '@/stores/authStore';

const MAX_COVER_BYTES = 10 * 1024 * 1024;

interface UseChangeCoverResult {
  changeCover: () => Promise<void>;
  changing: boolean;
}

/**
 * 更换当前用户的朋友圈封面：相册选图 → 上传 covers → PATCH cover → 回写全局用户。
 * 仅用于「自己的」朋友圈相册。`onChanged` 回传新封面 URL 供页面即时刷新。
 */
export function useChangeCover(
  userId: string,
  onChanged: (coverUrl: string) => void,
): UseChangeCoverResult {
  const { t } = useTranslation();
  const setUser = useAuthStore((state) => state.setUser);
  const [changing, setChanging] = useState(false);

  const changeCover = useCallback(async () => {
    if (changing) return;

    const imagePicker = loadImagePickerModule();
    if (!imagePicker) {
      Alert.alert(
        t('validation.cannotSelectImage'),
        t('validation.imagePickerNotAvailable'),
      );
      return;
    }

    const permission = await imagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        t('validation.cannotSelectImage'),
        t('validation.albumPermission'),
      );
      return;
    }

    const result = await imagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [3, 2],
      quality: 0.8,
      mediaTypes: ['images'],
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

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

    if (asset.fileSize && asset.fileSize > MAX_COVER_BYTES) {
      Alert.alert(t('validation.imageTooLarge'), t('validation.imageSizeLimit'));
      return;
    }

    setChanging(true);
    try {
      const filename = sanitizeUploadFilename(asset.fileName ?? 'cover.jpg');
      const { uploadUrl, fileUrl } = await requestUploadPresign({
        filename,
        contentType,
        folder: 'covers',
      });
      await uploadLocalFileToPresignedUrl(uploadUrl, contentType, asset.uri);

      const currentUser = useAuthStore.getState().user;
      const nextUser = await updateUserProfile(
        userId,
        { cover: fileUrl },
        currentUser,
      );
      setUser(nextUser);
      onChanged(fileUrl);
    } catch (error) {
      Alert.alert(
        t('moment.coverUpdateFailed'),
        error instanceof Error ? error.message : t('common.networkError'),
      );
    } finally {
      setChanging(false);
    }
  }, [changing, userId, onChanged, setUser, t]);

  return { changeCover, changing };
}
