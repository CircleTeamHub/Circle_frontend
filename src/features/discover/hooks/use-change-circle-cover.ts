import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  launchImageLibraryFast,
  loadImagePickerModule,
} from '@/features/profile/image-picker';
import { getCropLibraryPickerOptions, useImageCropStep } from '@/features/profile/image-crop-step';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { setCircleCover } from '@/services/api/circles';
import { reportHandledFailure } from '@/observability/report-failure';

const MAX_COVER_BYTES = 10 * 1024 * 1024;

interface UseChangeCircleCoverResult {
  changeCover: () => Promise<void>;
  changing: boolean;
  /** 相册选图后的裁剪页，由调用方渲染。 */
  cropper: ReactNode;
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
  const { cropIfNeeded, cropper } = useImageCropStep('free');

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

      // 裁剪完成后才上传，取消裁剪不改变当前封面。
      const outcome = await launchImageLibraryFast(imagePicker, {
        quality: 0.8,
        mediaTypes: ['images'],
        ...getCropLibraryPickerOptions('free'),
      });
      if (outcome.status === 'denied') {
        Alert.alert(
          t('validation.cannotSelectImage'),
          t('validation.albumPermission'),
        );
        return;
      }
      const { result } = outcome;
      if (result.canceled || !result.assets[0]) return;

      const asset = await cropIfNeeded(result.assets[0]);
      if (!asset) return;
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
        reportHandledFailure('circle', 'coverUpdate', error);
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
  }, [changing, cropIfNeeded, circleId, onChanged, t]);

  return { changeCover, changing, cropper };
}
