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

/** WeChat caps description photos at 9; mirror that on the client. */
export const FRIEND_PHOTO_NOTE_LIMIT = 9;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

interface UseFriendPhotoNotesResult {
  photos: string[];
  addPhoto: () => Promise<void>;
  removePhoto: (url: string) => void;
  uploading: boolean;
  canAddMore: boolean;
}

/**
 * Collects "description photo" notes for a friend request: pick from the album,
 * upload to the `friends` bucket, and accumulate the resulting URLs locally.
 * The URLs are submitted with the request and promoted on accept — nothing is
 * persisted server-side until the request is sent.
 */
export function useFriendPhotoNotes(): UseFriendPhotoNotesResult {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // A ref closes the double-tap window synchronously (state flips too late).
  const inFlightRef = useRef(false);

  const addPhoto = useCallback(async () => {
    if (inFlightRef.current || uploading) return;
    if (photos.length >= FRIEND_PHOTO_NOTE_LIMIT) {
      Alert.alert(
        t('contacts.request.photos.limitTitle'),
        t('contacts.request.photos.limitHint', {
          count: FRIEND_PHOTO_NOTE_LIMIT,
        }),
      );
      return;
    }

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

      if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
        Alert.alert(t('validation.imageTooLarge'), t('validation.imageSizeLimit'));
        return;
      }

      setUploading(true);
      try {
        const filename = sanitizeUploadFilename(asset.fileName ?? 'photo.jpg');
        const { uploadUrl, fileUrl, requiredHeaders } = await requestUploadPresign({
          filename,
          contentType,
          folder: 'friends',
          fileUri: asset.uri,
        });
        await uploadLocalFileToPresignedUrl(
          uploadUrl,
          contentType,
          asset.uri,
          requiredHeaders,
        );
        setPhotos((current) =>
          current.includes(fileUrl) ? current : [...current, fileUrl],
        );
      } catch {
        Alert.alert(
          t('contacts.request.photos.uploadFailedTitle'),
          t('common.networkError'),
        );
      } finally {
        setUploading(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [photos.length, t, uploading]);

  const removePhoto = useCallback((url: string) => {
    setPhotos((current) => current.filter((photo) => photo !== url));
  }, []);

  return {
    photos,
    addPhoto,
    removePhoto,
    uploading,
    canAddMore: photos.length < FRIEND_PHOTO_NOTE_LIMIT,
  };
}
