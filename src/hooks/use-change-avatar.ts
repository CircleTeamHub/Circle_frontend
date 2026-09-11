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
import { getApiErrorMessage } from '@/services/api/errors';

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

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
  changeAvatar: () => Promise<void>;
  changing: boolean;
}

/**
 * 更换方形头像(群聊 / 圈子共用):相册选图(1:1)→ 上传 avatars → 交给调用方的
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
        onFailure(error);
        Alert.alert(
          failureTitle,
          getApiErrorMessage(error, t('common.networkError')),
        );
      } finally {
        setChanging(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [changing, failureTitle, onChanged, onFailure, submit, t]);

  return { changeAvatar, changing };
}
