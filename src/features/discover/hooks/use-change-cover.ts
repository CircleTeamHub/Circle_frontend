import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  launchImageLibraryFast,
  loadImagePickerModule,
} from '@/features/profile/image-picker';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { updateUserProfile } from '@/services/api/profile';
import { useAuthStore } from '@/stores/authStore';
import { readUserProfileCache, writeUserProfileCache } from '@/features/user/profile-cache';
import { reportHandledFailure } from '@/observability/report-failure';

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
  // `changing` state only flips once upload starts, so two fast taps could both
  // clear it and open two pickers / fire two uploads. The ref closes that window
  // synchronously across the whole operation (pick → upload → write).
  const inFlightRef = useRef(false);

  const changeCover = useCallback(async () => {
    if (inFlightRef.current || changing) return;
    inFlightRef.current = true;
    const sessionEpoch = useAuthStore.getState().sessionEpoch;
    try {
      const imagePicker = loadImagePickerModule();
      if (!imagePicker) {
        Alert.alert(
          t('validation.cannotSelectImage'),
          t('validation.imagePickerNotAvailable'),
        );
        return;
      }

      // 原生编辑完成后才上传，取消裁剪不改变当前封面。
      const outcome = await launchImageLibraryFast(imagePicker, {
        quality: 0.8,
        mediaTypes: ['images'],
        allowsEditing: true,
      });
      if (outcome.status === 'denied') {
        Alert.alert(
          t('validation.cannotSelectImage'),
          t('validation.albumPermission'),
        );
        return;
      }
      const { result } = outcome;

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

        const auth = useAuthStore.getState();
        if (auth.sessionEpoch !== sessionEpoch || auth.user?.id !== userId) return;
        const currentUser = auth.user;
        const nextUser = await updateUserProfile(
          userId,
          { cover: fileUrl },
          currentUser,
        );
        const currentAuth = useAuthStore.getState();
        if (currentAuth.sessionEpoch !== sessionEpoch || currentAuth.user?.id !== userId) return;
        const album = readUserProfileCache(sessionEpoch, userId)?.album;
        if (album) writeUserProfileCache(sessionEpoch, userId, { album: { value: { ...album.value, cover: fileUrl }, at: Date.now() } });
        setUser(nextUser);
        onChanged(fileUrl);
      } catch (error) {
        reportHandledFailure('profile', 'coverUpdate', error);
        Alert.alert(
          t('moment.coverUpdateFailed'),
          t('common.networkError'),
        );
      } finally {
        setChanging(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [changing, userId, onChanged, setUser, t]);

  return { changeCover, changing };
}
