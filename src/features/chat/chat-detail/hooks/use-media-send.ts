import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import * as ImagePicker from 'expo-image-picker';
import { type ChatMediaFile } from '@/features/chat/chat-detail/types';
import { assertMyTempChatConversationOpen } from '@/services/api/temp-chat';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { uploadChatImageThumbnail } from '@/features/chat/utils/image-thumbnail';
import {
  failMediaSend,
  finishMediaSend,
  type PendingMediaUpload,
  sendImageMessage,
  sendVideoMessage,
  startMediaSend,
} from '@/chat-core/client';
import { logChatSendFailure } from '@/features/chat/chat-detail/helpers';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import {
  isChatImageTooLarge,
  isChatVideoTooLarge,
  isChatVideoTooLong,
} from '@/features/chat/utils/chat-media-policy';
import { Alert } from 'react-native';
import { assertLocalCanSendMessage } from '@/services/api/credit-policy';
import { VIDEO_UPLOAD_TIMEOUT_MS } from '@/features/chat/chat-detail/constants';
import { type MediaSourceAction } from '@/features/chat/components/media-source-sheet';
import { type TFunction } from 'i18next';

export interface MediaSendParams {
  t: TFunction<"translation", undefined>;
  inFlightRef: RefObject<boolean>;
  setSendError: Dispatch<SetStateAction<string | null>>;
  mountedRef: RefObject<boolean>;
  reuploadPendingMediaRef: RefObject<((upload: PendingMediaUpload) => Promise<void>) | null>;
  sourceID: string;
  conversationID: string;
  isTempChat: boolean;
  conversationType: "group" | "single";
  isGroupChat: boolean;
  isPreviewMode: boolean;
  uploadAndSendVoice: (soundPath: string, duration: number, deliveryId: string) => Promise<void>;
}

/**
 * 聊天页的图片/视频发送:相册与拍照入口、照片编辑后发送、先上屏后上传(失败标红可重发),
 * 以及 App 重启后从持久副本重新上传(reuploadPendingMedia,经 ref 交给消息长按菜单)。
 */
export function useMediaSend({
  t,
  inFlightRef,
  setSendError,
  mountedRef,
  reuploadPendingMediaRef,
  sourceID,
  conversationID,
  isTempChat,
  conversationType,
  isGroupChat,
  isPreviewMode,
  uploadAndSendVoice,
}: MediaSendParams) {
  const [mediaSourceSheetVisible, setMediaSourceSheetVisible] = useState(false);
  const [photoEditorAsset, setPhotoEditorAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  // 视频可能接近 100MB。上传成功但 socket ack 失败时，重发只应复用已上传的 key，
  // 不能再传一遍并制造孤儿对象；成功发送或卸载后释放这份内存索引。
  const uploadedVideoKeysRef = useRef(new Map<string, string>());
  useEffect(() => {
    const uploadedVideoKeys = uploadedVideoKeysRef.current;
    return () => {
      uploadedVideoKeys.clear();
    };
  }, []);

  /**
   * 图片的「上传 + 发送」。首发与长按重发共用 —— 重发必须带同一个 deliveryId,
   * 否则时间线里会多出一条,而不是把那个红气泡换掉。
   */
  const uploadAndSendImage = useCallback(
    async (
      asset: ChatMediaFile,
      filename: string,
      contentType: string,
      deliveryId: string,
    ) => {
      try {
        if (isTempChat) {
          await assertMyTempChatConversationOpen(conversationID);
        }
        // 不日志 presign 返回的 fileUrl / uploadUrl —— 这是带签名的临时写凭证，
        // 任何能捕获 console 输出的渠道（adb logcat、屏幕录制、第三方 SDK 的
        // breadcrumb）拿到 uploadUrl 就能在过期前向同一对象写入任意内容。
        const presign = await requestUploadPresign({
          filename: sanitizeUploadFilename(filename),
          contentType,
          folder: 'chat',
          fileUri: asset.uri,
        });
        await uploadLocalFileToPresignedUrl(
          presign.uploadUrl,
          contentType,
          asset.uri,
          presign.requiredHeaders,
        );

        // 生成并上传一张缩略图供列表气泡显示；失败 / 原图已够小时退化为原图（thumb* 留空）。
        const thumbnail = await uploadChatImageThumbnail(
          asset.uri,
          asset.width ?? undefined,
          filename,
        );

        await sendImageMessage({
          conversationId: conversationID,
          key: presign.key,
          localUri: asset.uri,
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          thumbKey: thumbnail?.key,
          deliveryId,
        });
        finishMediaSend(deliveryId);
      } catch (error) {
        logChatSendFailure(error, {
          kind: 'image',
          sessionType: conversationType,
          isGroupChat,
        });
        // 气泡标红留在原地(长按可重发),而不是让这张图凭空消失。
        failMediaSend(conversationID, deliveryId);
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.imageSendFailed', {
                defaultValue: '图片发送失败，请重试',
              }),
            ),
          );
        }
      }
    },
    [conversationID, conversationType, isGroupChat, isTempChat, t, mountedRef, setSendError],
  );
  // 相册选择与拍照共用同一套「上传→发送」流程，只有获取 asset 的来源不同。
  const uploadAndSendImageAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      // 体积 gate 与下面的 assertLocalCanSendMessage 同理：在 presign+上传之前拦掉。
      // 否则一张几十 MB 的原图会整份传完、用户干等之后才发现发不出去。上限与头像 /
      // 圈子封面 / 好友照片一致（10MB），此前只有聊天发图这条路径漏了 gate。
      if (isChatImageTooLarge(asset.fileSize)) {
        Alert.alert(t('validation.imageTooLarge'), t('validation.imageSizeLimit'));
        return false;
      }

      // 用 || 而非 ??：URI 以 '/' 结尾时 pop() 返回空字符串，?? 不会触发 fallback。
      const filename = asset.uri.split('/').pop() || 'image.jpg';
      const contentType =
        resolveUploadContentType({
          mimeType: asset.mimeType,
          fileName: filename,
        }) ?? 'image/jpeg';

      // 提前拦一次：文本等廉价路径靠 reportSend 统一 gate 即可，但图片要先
      // presign+上传（有成本，且会发一个带签名的临时写凭证给可能被拦的用户）。
      // 在动手上传前就挡掉，避免无谓开销与凭证外泄面。发送本身仍会在 reportSend
      // 再兜一层，两处同源（assertLocalCanSendMessage），不会产生口径分叉。
      try {
        assertLocalCanSendMessage();
      } catch (error) {
        if (mountedRef.current) {
          const message = getChatSendErrorMessage(
            error,
            t('chat.detail.imageSendFailed', {
              defaultValue: '图片发送失败，请重试',
            }),
          );
          setSendError(message);
          // 照片编辑器是全屏 Modal，输入栏上的 sendError 此时不可见；同步弹出
          // 可操作的错误提示，同时保留编辑器，用户可以继续调整或取消。
          Alert.alert(
            t('common.errorOccurred', { defaultValue: '操作失败' }),
            message,
          );
        }
        return false;
      }

      // 先上屏、后台上传:和语音同一套 —— 上传期间气泡是「发送中」,
      // 输入栏不锁,失败标红可长按重发。
      const deliveryId = startMediaSend({
        conversationId: conversationID,
        type: 'image',
        localContent: {
          localUri: asset.uri,
          ...(asset.width ? { width: asset.width } : {}),
          ...(asset.height ? { height: asset.height } : {}),
        },
        retry: (id) => uploadAndSendImage(asset, filename, contentType, id),
        source: { uri: asset.uri, uploadName: filename, contentType },
      });
      void uploadAndSendImage(asset, filename, contentType, deliveryId);
      return true;
    },
    [conversationID, t, uploadAndSendImage, mountedRef, setSendError],
  );

  const uploadAndSendVideo = useCallback(
    async (
      asset: ChatMediaFile,
      filename: string,
      contentType: string,
      deliveryId: string,
    ) => {
      try {
        if (isTempChat) {
          await assertMyTempChatConversationOpen(conversationID);
        }
        let key = uploadedVideoKeysRef.current.get(deliveryId);
        if (!key) {
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(filename),
            contentType,
            folder: 'chat',
            fileUri: asset.uri,
          });
          await uploadLocalFileToPresignedUrl(
            presign.uploadUrl,
            contentType,
            asset.uri,
            presign.requiredHeaders,
            VIDEO_UPLOAD_TIMEOUT_MS,
          );
          key = presign.key;
          uploadedVideoKeysRef.current.set(deliveryId, key);
        }
        await sendVideoMessage({
          conversationId: conversationID,
          key,
          localUri: asset.uri,
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          duration:
            typeof asset.duration === 'number'
              ? Math.max(1, Math.ceil(asset.duration / 1000))
              : undefined,
          size: asset.fileSize ?? undefined,
          deliveryId,
        });
        uploadedVideoKeysRef.current.delete(deliveryId);
        finishMediaSend(deliveryId);
      } catch (error) {
        logChatSendFailure(error, {
          kind: 'video',
          sessionType: conversationType,
          isGroupChat,
        });
        failMediaSend(conversationID, deliveryId);
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.videoSendFailed', {
                defaultValue: '视频发送失败，请重试',
              }),
            ),
          );
        }
      }
    },
    [conversationID, conversationType, isGroupChat, isTempChat, t, mountedRef, setSendError],
  );

  const uploadAndSendVideoAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      if (isChatVideoTooLarge(asset.fileSize)) {
        Alert.alert(
          t('chat.detail.videoRejectedTitle', { defaultValue: '视频无法发送' }),
          t('chat.detail.videoTooLarge', { defaultValue: '请选择 100MB 以内的视频' }),
        );
        return;
      }
      if (isChatVideoTooLong(asset.duration)) {
        Alert.alert(
          t('chat.detail.videoRejectedTitle', { defaultValue: '视频无法发送' }),
          t('chat.detail.videoTooLong', { defaultValue: '请选择 10 分钟以内的视频' }),
        );
        return;
      }

      const filename = asset.fileName || asset.uri.split('/').pop() || 'video.mp4';
      const contentType = resolveUploadContentType({
        mimeType: asset.mimeType,
        fileName: filename,
      });
      if (!contentType?.startsWith('video/')) {
        Alert.alert(
          t('chat.detail.videoRejectedTitle', { defaultValue: '视频无法发送' }),
          t('chat.detail.videoUnsupported', {
            defaultValue: '仅支持 MP4、MOV、M4V 视频',
          }),
        );
        return;
      }

      try {
        assertLocalCanSendMessage();
      } catch (error) {
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.videoSendFailed', {
                defaultValue: '视频发送失败，请重试',
              }),
            ),
          );
        }
        return;
      }

      const deliveryId = startMediaSend({
        conversationId: conversationID,
        type: 'video',
        localContent: {
          localUri: asset.uri,
          ...(asset.width ? { width: asset.width } : {}),
          ...(asset.height ? { height: asset.height } : {}),
          ...(typeof asset.duration === 'number'
            ? { duration: Math.max(1, Math.ceil(asset.duration / 1000)) }
            : {}),
          ...(asset.fileSize ? { size: asset.fileSize } : {}),
        },
        retry: (id) => uploadAndSendVideo(asset, filename, contentType, id),
        source: { uri: asset.uri, uploadName: filename, contentType },
      });
      void uploadAndSendVideo(asset, filename, contentType, deliveryId);
    },
    [conversationID, t, uploadAndSendVideo, mountedRef, setSendError],
  );

  /**
   * App 被杀之后重发一条还没传完的媒体:内存里的重试闭包已经没了,从 outbox 记下的
   * 持久副本重跑同一条「上传 + 发送」(失败照样标红、可再重发)。
   */
  const reuploadPendingMedia = useCallback(
    async ({ deliveryId, record, uri }: PendingMediaUpload) => {
      switch (record.type) {
        case 'voice':
          await uploadAndSendVoice(uri, record.duration ?? 1, deliveryId);
          return;
        case 'image':
          await uploadAndSendImage(
            { uri, width: record.width, height: record.height },
            record.uploadName,
            record.contentType,
            deliveryId,
          );
          return;
        case 'video':
          await uploadAndSendVideo(
            {
              uri,
              width: record.width,
              height: record.height,
              // 记录里存的是秒,上传管线吃 ImagePicker 的毫秒。
              duration:
                record.duration === undefined ? undefined : record.duration * 1000,
              fileSize: record.size,
            },
            record.uploadName,
            record.contentType,
            deliveryId,
          );
          return;
      }
    },
    [uploadAndSendImage, uploadAndSendVideo, uploadAndSendVoice],
  );
  useEffect(() => {
    reuploadPendingMediaRef.current = reuploadPendingMedia;
  }, [reuploadPendingMedia, reuploadPendingMediaRef]);

  const handlePickLibraryMedia = useCallback(
    async (kind: 'photo' | 'video') => {
      if (!sourceID || isPreviewMode) return;
      if (inFlightRef.current) return;
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('permissions.insufficientTitle'), t('permissions.photoLibrary'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === 'photo' ? ['images'] : ['videos'],
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      const pickedAsset = result.assets[0];
      if (kind === 'photo') {
        setPhotoEditorAsset(pickedAsset);
        return;
      }
      await uploadAndSendVideoAsset(pickedAsset);
    },
    [isPreviewMode, sourceID, t, uploadAndSendVideoAsset, inFlightRef],
  );

  const handleTakePhoto = useCallback(async () => {
    if (!sourceID || isPreviewMode) return;
    if (inFlightRef.current) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('permissions.insufficientTitle'), t('permissions.camera'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) return;
    setPhotoEditorAsset(result.assets[0]);
  }, [isPreviewMode, sourceID, t, inFlightRef]);

  const handleSendEditedPhoto = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      const accepted = await uploadAndSendImageAsset(asset);
      if (accepted && mountedRef.current) {
        setPhotoEditorAsset(null);
      }
      return accepted;
    },
    [uploadAndSendImageAsset, mountedRef],
  );

  const handleMediaSourceSelect = useCallback(
    (action: MediaSourceAction) => {
      setMediaSourceSheetVisible(false);
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        if (action === 'photo') {
          void handlePickLibraryMedia('photo');
        } else if (action === 'video') {
          void handlePickLibraryMedia('video');
        } else {
          void handleTakePhoto();
        }
      });
    },
    [handlePickLibraryMedia, handleTakePhoto, mountedRef],
  );

  return {
    mediaSourceSheetVisible,
    setMediaSourceSheetVisible,
    photoEditorAsset,
    setPhotoEditorAsset,
    handleSendEditedPhoto,
    handleMediaSourceSelect,
  };
}
