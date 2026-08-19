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
import { setCircleCover } from '@/services/api/circles';

const MAX_COVER_BYTES = 10 * 1024 * 1024;

interface UseChangeCircleCoverResult {
  changeCover: () => Promise<void>;
  changing: boolean;
}

/**
 * 更换圈子封面：相册选图 → 上传 covers → POST /circle/:id/cover → 回写详情页。
 * 仅圈主可用（后端 assertOwner）。`onChanged` 回传新封面 URL 供页面即时刷新。
 * 逻辑与朋友圈封面 useChangeCover 一致，只是落库走圈子专用端点。
 */
export function useChangeCircleCover(
  circleId: string,
  onChanged: (coverUrl: string) => void,
): UseChangeCircleCoverResult {
  const { t } = useTranslation();
  const [changing, setChanging] = useState(false);
  // ref closes the double-tap window synchronously across pick → upload → write.
  const inFlightRef = useRef(false);

  const changeCover = useCallback(async () => {
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
        aspect: [3, 2],
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

      if (asset.fileSize && asset.fileSize > MAX_COVER_BYTES) {
        Alert.alert(
          t('validation.imageTooLarge'),
          t('validation.imageSizeLimit'),
        );
        return;
      }

      setChanging(true);
      try {
        const filename = sanitizeUploadFilename(asset.fileName ?? 'cover.jpg');
        const { uploadUrl, fileUrl, requiredHeaders } = await requestUploadPresign({
          filename,
          contentType,
          folder: 'covers',
          fileUri: asset.uri,
        });
        await uploadLocalFileToPresignedUrl(
          uploadUrl,
          contentType,
          asset.uri,
          requiredHeaders,
        );
        await setCircleCover(circleId, fileUrl);
        onChanged(fileUrl);
      } catch (error) {
        if (__DEV__) {
          console.warn('[useChangeCircleCover] cover update failed', error);
        }
        Alert.alert(
          t('circle.coverUpdateFailed', { defaultValue: '封面更新失败' }),
          t('common.networkError'),
        );
      } finally {
        setChanging(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [changing, circleId, onChanged, t]);

  return { changeCover, changing };
}
