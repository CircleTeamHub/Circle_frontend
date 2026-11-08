import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { loadImagePickerModule } from '@/features/profile/image-picker';
import { getCropLibraryPickerOptions, useImageCropStep } from '@/features/profile/image-crop-step';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuthStore } from '@/stores/authStore';

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

export type AvatarImageSource = 'camera' | 'library';

export interface ChangeAvatarOptions {
  /** 落库:拿到已上传的 fileUrl,写到对应端点(群/圈子各自的)。 */
  submit: (fileUrl: string) => Promise<void>;
  /** 落库成功后的本机回写(列表/标题立刻用新头像,不等服务端广播)。 */
  onChanged: (avatarUrl: string) => void;
  /** 失败弹窗标题(已翻译);正文由 getApiErrorMessage 按错误码给。 */
  failureTitle: string;
  /**
   * 诊断上报。刻意留给调用方而不是收进来:reportHandledFailure 的
   * operation/kind 要进 Sentry fingerprint,必须是调用点上看得见的字面量
   * (见 test/handled-failure-coverage.test.js)。
   */
  onFailure: (error: unknown) => void;
}

export interface ChangeAvatarResult {
  changeAvatar: (source?: AvatarImageSource) => Promise<void>;
  changing: boolean;
  /** 相册选图后的裁剪页，渲染进发起更换的那个原生 Modal（见 AvatarPhotoViewer）。 */
  cropper: ReactNode;
}

/**
 * 更换方形头像(个人 / 群聊 / 圈子共用):拍照或相册选图(1:1)→ 上传 avatars → 交给调用方的
 * submit 落库 → onChanged 本机回写。
 *
 * 群头像与圈子头像原来是两份逐字复制的 115 行,只差落库调用和一个文案 key;
 * 复制的那一份连失败提示都是写死的 `common.networkError`,于是
 * CHAT_GROUP_AVATAR_URL_INVALID / CHAT_GROUP_MANAGER_ONLY 这些服务端说清楚了
 * 原因的拒绝,到用户那儿一律变成「网络错误」。失败正文统一走 getApiErrorMessage:
 * 认识的错误码出本地化文案,不认识的才回落网络错误,原始错误文本永不透出。
 *
 * 预签名的 requiredHeaders 必须原样转发给上传请求 —— SDK 把它们全签进了
 * 签名里,少一个头 MinIO 就 400。
 */
export function useChangeAvatar(options: ChangeAvatarOptions): ChangeAvatarResult {
  const { submit, onChanged, failureTitle, onFailure } = options;
  const { t } = useTranslation();
  const [changing, setChanging] = useState(false);
  // changing 只在上传开始后才翻,两次快速点击会各开一个选择器、各发一次上传。
  // ref 在整段操作(选图 → 上传 → 落库)上同步关窗。
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const { cropIfNeeded, cropper } = useImageCropStep('square');

  // 头像页加载时就把原生模块准备好，点击行时直接进入相册；不能把首次
  // require 的桥接初始化时间叠加到用户的点击反馈上。
  useEffect(() => {
    mountedRef.current = true;
    try {
      loadImagePickerModule();
    } catch {
      // 点击时会再次加载并按现有错误路径提示，预加载不改变失败语义。
    }
    return () => { mountedRef.current = false; };
  }, []);

  const changeAvatar = useCallback(async (source: AvatarImageSource = 'library') => {
    if (inFlightRef.current || changing) return;
    inFlightRef.current = true;
    const { sessionEpoch, user } = useAuthStore.getState();
    const stillCurrent = () => {
      const current = useAuthStore.getState();
      return mountedRef.current && current.sessionEpoch === sessionEpoch && current.user?.id === user?.id;
    };
    try {
      const imagePicker = loadImagePickerModule();
      if (!imagePicker) {
        Alert.alert(
          t('validation.cannotSelectImage'),
          t('validation.imagePickerNotAvailable'),
        );
        return;
      }

      // 系统编辑器让用户在上传前确认头像裁剪；相册在 iOS 上改走应用内裁剪，保持秒开。
      const cameraOptions: Parameters<typeof imagePicker.launchCameraAsync>[0] = {
        quality: 0.8,
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
      };
      const libraryOptions: Parameters<typeof imagePicker.launchImageLibraryAsync>[0] = {
        quality: 0.8,
        mediaTypes: ['images'],
        ...getCropLibraryPickerOptions('square'),
      };
      let result: Awaited<ReturnType<typeof imagePicker.launchImageLibraryAsync>>;
      if (source === 'camera') {
        try {
          const permission = await imagePicker.requestCameraPermissionsAsync();
          if (!stillCurrent()) return;
          if (!permission.granted) {
            Alert.alert(t('permissions.insufficientTitle'), t('permissions.camera'));
            return;
          }
          result = await imagePicker.launchCameraAsync(cameraOptions);
        } catch (error) {
          if (!stillCurrent()) return;
          onFailure(error);
          Alert.alert(
            failureTitle,
            getApiErrorMessage(error, t('common.networkError')),
          );
          return;
        }
      } else {
        // 先直接唤起系统选择器，只有失败时才等待权限桥接，避免延迟相册呈现。
        try {
          result = await imagePicker.launchImageLibraryAsync(libraryOptions);
        } catch {
          if (!stillCurrent()) return;
          let permission;
          try {
            permission = await imagePicker.requestMediaLibraryPermissionsAsync();
          } catch (permissionError) {
            if (!stillCurrent()) return;
            onFailure(permissionError);
            Alert.alert(
              failureTitle,
              getApiErrorMessage(permissionError, t('common.networkError')),
            );
            return;
          }
          if (!stillCurrent()) return;
          if (!permission.granted) {
            Alert.alert(
              t('validation.cannotSelectImage'),
              t('validation.albumPermission'),
            );
            return;
          }
          try {
            result = await imagePicker.launchImageLibraryAsync(libraryOptions);
          } catch (retryError) {
            if (!stillCurrent()) return;
            onFailure(retryError);
            Alert.alert(
              failureTitle,
              getApiErrorMessage(retryError, t('common.networkError')),
            );
            return;
          }
        }
      }
      if (!stillCurrent()) return;
      if (result.canceled || !result.assets[0]) return;

      const asset = source === 'library' ? await cropIfNeeded(result.assets[0]) : result.assets[0];
      if (!asset || !stillCurrent()) return;
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
        if (!stillCurrent()) return;
        await uploadLocalFileToPresignedUrl(
          uploadUrl,
          contentType,
          asset.uri,
          requiredHeaders,
        );
        if (!stillCurrent()) return;
        await submit(fileUrl);
        if (!stillCurrent()) return;
        onChanged(fileUrl);
      } catch (error) {
        if (!stillCurrent()) return;
        onFailure(error);
        Alert.alert(
          failureTitle,
          getApiErrorMessage(error, t('common.networkError')),
        );
      } finally {
        if (mountedRef.current) setChanging(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [changing, cropIfNeeded, failureTitle, onChanged, onFailure, submit, t]);

  return { changeAvatar, changing, cropper };
}
