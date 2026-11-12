import { mediaErrorGuard } from '@/features/chat/utils/media-error-guard';
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
import { launchImageLibraryFast } from '@/features/profile/image-picker';
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
  planChatImageUpload,
  prepareChatImageForUpload,
} from '@/features/chat/utils/chat-image-compress';
import {
  isChatVideoCompressionAvailable,
  prepareChatVideoForUpload,
} from '@/features/chat/utils/chat-video-compress';
import { uploadChatVideoPoster } from '@/features/chat/utils/chat-video-poster';
import { hideTopNotice, showTopNotice } from '@/components/app/top-notice-store';
import {
  assertMediaSendSessionCurrent,
  failMediaSend,
  finishMediaSend,
  type PendingMediaUpload,
  sendImageMessage,
  sendTextMessage,
  sendVideoMessage,
  startMediaSend,
} from '@/chat-core/client';
import { startChatSend } from '@/chat-core/send-handle';
import { logChatSendFailure } from '@/features/chat/chat-detail/helpers';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import {
  isChatImageTooLarge,
  isChatVideoTooLarge,
  isChatVideoTooLong,
} from '@/features/chat/utils/chat-media-policy';
import { Alert, Platform } from 'react-native';
import { assertLocalCanSendMessage } from '@/services/api/credit-policy';
import { reportHandledFailure } from '@/observability/report-failure';
import { VIDEO_UPLOAD_TIMEOUT_MS } from '@/features/chat/chat-detail/constants';
import { type MediaSourceAction } from '@/features/chat/components/media-source-sheet';
import { type MediaGalleryMode } from '@/features/chat/utils/media-gallery';
import { type TFunction } from 'i18next';
import {
  chatMediaUploadScheduler,
  MAX_CHAT_IMAGE_SELECTION,
  type MediaUploadScheduler,
} from '@/features/chat/utils/media-upload-scheduler';

/** sent:这一项真的发出去了(服务端已确认),附言据此判断是否还要发。 */
type MediaSendTurn = { wait: Promise<void>; release: () => void; sent?: () => void };

/**
 * 给一批媒体排好上屏后的发送顺序:每一项等前一项发完(或失败)才真正发出,
 * 返回的 done 在最后一项结束后才 resolve(值为是否至少有一项发出),附言就挂在它后面。
 */
function chainMediaSends<T>(
  items: readonly T[],
  send: (item: T, turn: MediaSendTurn) => Promise<unknown>,
): { started: Promise<unknown[]>; done: Promise<boolean> } {
  let anySent = false;
  const sent = () => {
    anySent = true;
  };
  let previousSend = Promise.resolve();
  const started = Promise.all(
    items.map((item) => {
      const wait = previousSend;
      let release!: () => void;
      previousSend = new Promise<void>((resolve) => {
        // A skipped/failed asset still follows its predecessor in the chain.
        release = () => { void wait.then(resolve); };
      });
      return send(item, { wait, release, sent });
    }),
  );
  return { started, done: previousSend.then(() => anySent) };
}

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

function isVideoAsset(asset: ImagePicker.ImagePickerAsset): boolean {
  // web 端的选择器不一定带 type,再看一眼 mimeType。
  return asset.type === 'video' || asset.mimeType?.startsWith('video/') === true;
}

/** 压缩后仍超过上限:重发也不会变小,提示用户换更短的视频。 */
class ChatVideoTooLargeError extends Error {
  name = 'ChatVideoTooLargeError';
}

/**
 * 聊天页的图片/视频发送:应用内相册(直接发 / 编辑发送,描述在选图时填)与拍照入口、
 * 照片编辑后发送、先上屏后上传(失败标红可重发),
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
  // 应用内相册:send = 选完直接发,edit = 选一张照片进编辑器。描述都在相册里填。
  const [galleryMode, setGalleryMode] = useState<MediaGalleryMode | null>(null);
  const [photoEditorAsset, setPhotoEditorAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  // 编辑发送时在相册里填的描述,等编辑器点了发送再跟在照片后面发。
  const editorCaptionRef = useRef('');
  // iOS 上一个全屏弹层收起动画没结束时不能弹出下一个:先记下来,等 onDismiss 再执行。
  const pendingSourceActionRef = useRef<MediaSourceAction | null>(null);
  const pendingEditorRef = useRef<{ asset: ImagePicker.ImagePickerAsset; caption: string } | null>(null);
  const systemPickerBusyRef = useRef(false);
  // 视频可能接近 100MB。上传成功但 socket ack 失败时，重发只应复用已上传的 key，
  // 不能再传一遍并制造孤儿对象；成功发送或卸载后释放这份内存索引。封面同理。
  const uploadedVideoKeysRef = useRef(
    new Map<string, { key: string; thumbKey?: string; width?: number; height?: number; duration?: number; size?: number }>(),
  );
  // A picker can return dozens of assets at once. Keep expensive compression,
  // presign, and upload work bounded without putting queue state in React. The
  // pool is app-wide so navigating away from a chat cannot create a second
  // burst of uploads in a new screen instance.
  const mediaUploadScheduler: MediaUploadScheduler = chatMediaUploadScheduler;
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
      turn?: MediaSendTurn,
    ) => {
      const canReportError = mediaErrorGuard(conversationID, mountedRef);
      try {
        assertMediaSendSessionCurrent(deliveryId);
        if (isTempChat) {
          await assertMyTempChatConversationOpen(conversationID);
        }
        // 长边压到 2048、重新编码成 JPEG(顺带去掉 EXIF 里的拍摄地点);GIF 原样发。
        // 失败时发原图。重启后从持久副本重发会再压一次,副本本身是原图。
        const prepared = await prepareChatImageForUpload({
          uri: asset.uri,
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          contentType,
          filename,
        });
        // 不日志 presign 返回的 fileUrl / uploadUrl —— 这是带签名的临时写凭证，
        // 任何能捕获 console 输出的渠道（adb logcat、屏幕录制、第三方 SDK 的
        // breadcrumb）拿到 uploadUrl 就能在过期前向同一对象写入任意内容。
        const presign = await requestUploadPresign({
          filename: sanitizeUploadFilename(prepared.filename),
          contentType: prepared.contentType,
          folder: 'chat',
          fileUri: prepared.uri,
        });
        assertMediaSendSessionCurrent(deliveryId);
        await uploadLocalFileToPresignedUrl(
          presign.uploadUrl,
          prepared.contentType,
          prepared.uri,
          presign.requiredHeaders,
          undefined,
          { progressKey: deliveryId },
        );

        assertMediaSendSessionCurrent(deliveryId);
        // 生成并上传一张缩略图供列表气泡显示；失败 / 原图已够小时退化为原图（thumb* 留空）。
        const thumbnail = await uploadChatImageThumbnail(
          prepared.uri,
          prepared.width,
          prepared.filename,
          () => assertMediaSendSessionCurrent(deliveryId),
          deliveryId,
        );

        await turn?.wait;
        assertMediaSendSessionCurrent(deliveryId);
        await sendImageMessage({
          conversationId: conversationID,
          key: presign.key,
          localUri: asset.uri,
          width: prepared.width,
          height: prepared.height,
          thumbKey: thumbnail?.key,
          deliveryId,
        });
        finishMediaSend(deliveryId);
        turn?.sent?.();
      } catch (error) {
        logChatSendFailure(error, {
          kind: 'image',
          sessionType: conversationType,
          isGroupChat,
        });
        // 气泡标红留在原地(长按可重发),而不是让这张图凭空消失。
        failMediaSend(conversationID, deliveryId);
        if (canReportError()) {
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
  const enqueueImageUpload = useCallback(
    (
      asset: ChatMediaFile,
      filename: string,
      contentType: string,
      deliveryId: string,
      turn?: MediaSendTurn,
    ) =>
      mediaUploadScheduler.enqueue(() =>
        uploadAndSendImage(asset, filename, contentType, deliveryId, turn),
      ).finally(() => turn?.release()),
    [mediaUploadScheduler, uploadAndSendImage],
  );
  // 相册选择与拍照共用同一套「上传→发送」流程，只有获取 asset 的来源不同。
  const uploadAndSendImageAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset, turn?: MediaSendTurn) => {
      // 用 || 而非 ??：URI 以 '/' 结尾时 pop() 返回空字符串，?? 不会触发 fallback。
      const filename = asset.uri.split('/').pop() || 'image.jpg';
      const contentType =
        resolveUploadContentType({
          mimeType: asset.mimeType,
          fileName: filename,
        }) ?? 'image/jpeg';

      // 体积 gate 与下面的 assertLocalCanSendMessage 同理：在 presign+上传之前拦掉。
      // 上限与头像 / 圈子封面 / 好友照片一致（10MB）。应用内相册给的是原图（48MP、
      // ProRAW 动辄几十 MB），而上传前会重新编码成长边 2048 的 JPEG，只有原样上传的
      // （GIF）才需要在这里按原图体积拦。
      const reencoded = planChatImageUpload({ uri: asset.uri, contentType, filename }).reencode;
      if (!reencoded && isChatImageTooLarge(asset.fileSize)) {
        Alert.alert(t('validation.imageTooLarge'), t('validation.imageSizeLimit'));
        turn?.release();
        return false;
      }

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
        turn?.release();
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
        retry: (id) => enqueueImageUpload(asset, filename, contentType, id),
        source: { uri: asset.uri, uploadName: filename, contentType },
      });
      void enqueueImageUpload(asset, filename, contentType, deliveryId, turn);
      return true;
    },
    [conversationID, t, enqueueImageUpload, mountedRef, setSendError],
  );

  const uploadAndSendVideo = useCallback(
    async (
      asset: ChatMediaFile,
      filename: string,
      contentType: string,
      deliveryId: string,
      turn?: MediaSendTurn,
    ) => {
      const canReportError = mediaErrorGuard(conversationID, mountedRef);
      try {
        assertMediaSendSessionCurrent(deliveryId);
        if (isTempChat) {
          await assertMyTempChatConversationOpen(conversationID);
        }
        let uploaded = uploadedVideoKeysRef.current.get(deliveryId);
        if (!uploaded) {
          const prepared = await prepareChatVideoForUpload(asset, filename, contentType);
          try {
            // 有压缩模块时选的那一刻放行了原片,体积在这里按压缩结果判断。
            if (isChatVideoTooLarge(prepared.asset.fileSize)) throw new ChatVideoTooLargeError();
            assertMediaSendSessionCurrent(deliveryId);
            const durationSeconds = typeof prepared.asset.duration === 'number'
              ? Math.max(1, Math.ceil(prepared.asset.duration / 1000))
              : undefined;
            const presign = await requestUploadPresign({
              filename: sanitizeUploadFilename(prepared.filename),
              contentType: prepared.contentType,
              folder: 'chat',
              fileUri: prepared.asset.uri,
            });
            assertMediaSendSessionCurrent(deliveryId);
            await uploadLocalFileToPresignedUrl(
              presign.uploadUrl,
              prepared.contentType,
              prepared.asset.uri,
              presign.requiredHeaders,
              VIDEO_UPLOAD_TIMEOUT_MS,
              { progressKey: deliveryId },
            );
            assertMediaSendSessionCurrent(deliveryId);
            const poster = await uploadChatVideoPoster(
              prepared.asset.uri,
              durationSeconds,
              prepared.filename,
              'chat',
              () => assertMediaSendSessionCurrent(deliveryId),
              deliveryId,
            );
            uploaded = {
              key: presign.key,
              thumbKey: poster?.key,
              width: prepared.asset.width ?? undefined,
              height: prepared.asset.height ?? undefined,
              duration: durationSeconds,
              size: prepared.asset.fileSize ?? undefined,
            };
            uploadedVideoKeysRef.current.set(deliveryId, uploaded);
          } finally {
            await prepared.cleanup?.();
          }
        }
        await turn?.wait;
        assertMediaSendSessionCurrent(deliveryId);
        await sendVideoMessage({
          conversationId: conversationID,
          key: uploaded.key,
          thumbKey: uploaded.thumbKey,
          localUri: asset.uri,
          width: uploaded.width,
          height: uploaded.height,
          duration: uploaded.duration,
          size: uploaded.size,
          deliveryId,
        });
        uploadedVideoKeysRef.current.delete(deliveryId);
        finishMediaSend(deliveryId);
        turn?.sent?.();
      } catch (error) {
        logChatSendFailure(error, {
          kind: 'video',
          sessionType: conversationType,
          isGroupChat,
        });
        failMediaSend(conversationID, deliveryId);
        if (canReportError()) {
          setSendError(
            // 压缩失败或没压缩时也会走到这里,所以不提「压缩后」。
            error instanceof ChatVideoTooLargeError
              ? t('chat.detail.videoTooLarge', { defaultValue: '请选择 100MB 以内的视频' })
              : getChatSendErrorMessage(
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
  const enqueueVideoUpload = useCallback(
    (
      asset: ChatMediaFile,
      filename: string,
      contentType: string,
      deliveryId: string,
      turn?: MediaSendTurn,
    ) =>
      mediaUploadScheduler.enqueue(() =>
        uploadAndSendVideo(asset, filename, contentType, deliveryId, turn),
      ).finally(() => turn?.release()),
    [mediaUploadScheduler, uploadAndSendVideo],
  );

  const uploadAndSendVideoAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset, turn?: MediaSendTurn) => {
      // 会压缩的话原片超过上限也先放行(手机拍的 4K 原片动辄几百 MB),压缩后再判断。
      if (!isChatVideoCompressionAvailable() && isChatVideoTooLarge(asset.fileSize)) {
        turn?.release();
        Alert.alert(
          t('chat.detail.videoRejectedTitle', { defaultValue: '视频无法发送' }),
          t('chat.detail.videoTooLarge', { defaultValue: '请选择 100MB 以内的视频' }),
        );
        return;
      }
      if (isChatVideoTooLong(asset.duration)) {
        turn?.release();
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
        turn?.release();
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
        turn?.release();
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
        retry: (id) => enqueueVideoUpload(asset, filename, contentType, id),
        source: { uri: asset.uri, uploadName: filename, contentType },
      });
      void enqueueVideoUpload(asset, filename, contentType, deliveryId, turn);
    },
    [conversationID, t, enqueueVideoUpload, mountedRef, setSendError],
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
          await enqueueImageUpload(
            { uri, width: record.width, height: record.height },
            record.uploadName,
            record.contentType,
            deliveryId,
          );
          return;
        case 'video':
          await enqueueVideoUpload(
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
    [enqueueImageUpload, enqueueVideoUpload, uploadAndSendVoice],
  );
  useEffect(() => {
    reuploadPendingMediaRef.current = reuploadPendingMedia;
  }, [reuploadPendingMedia, reuploadPendingMediaRef]);

  /**
   * 附言作为一条普通文字消息,等这一批媒体都发完(或失败)再发,保证排在它们后面。
   * 一项都没发出去时不发附言:否则红气泡长按重发后会排到附言后面,附言也成了孤零零一句。
   */
  const sendCaptionAfter = useCallback(
    (done: Promise<boolean>, caption: string) => {
      if (!caption) return;
      void done.then((anySent) => {
        if (!anySent) {
          if (mountedRef.current) {
            setSendError(
              t('chat.detail.captionNotSent', {
                defaultValue: '图片或视频没有发出，附言也没有发送',
              }),
            );
          }
          return;
        }
        const handle = startChatSend((onCreate) =>
          sendTextMessage({ conversationId: conversationID, text: caption, onCreate }),
        );
        // 进了队列之后的失败会在气泡上标红、可长按重发;没进队列是本地门禁直接拦下。
        handle.delivered.catch((error: unknown) => {
          if (handle.queued) return;
          if (mountedRef.current) {
            setSendError(
              getChatSendErrorMessage(
                error,
                t('chat.sendFailed', { defaultValue: '消息发送失败，请重试' }),
              ),
            );
          }
        });
      });
    },
    [conversationID, mountedRef, setSendError, t],
  );

  /** 相册里选好的一批直接发出(不经过编辑器),描述跟在最后。 */
  const sendPickedMedia = useCallback(
    (assets: ImagePicker.ImagePickerAsset[], caption: string) => {
      // Every selected item gets its own optimistic bubble and enters the
      // bounded scheduler immediately; one failed upload cannot hide others.
      // Items rejected up front (size/type gates) release their turn, and the
      // caption is held back when nothing in the batch went out.
      const { done } = chainMediaSends(assets, (asset, turn) =>
        isVideoAsset(asset)
          ? uploadAndSendVideoAsset(asset, turn)
          : uploadAndSendImageAsset(asset, turn),
      );
      sendCaptionAfter(done, caption);
    },
    [sendCaptionAfter, uploadAndSendImageAsset, uploadAndSendVideoAsset],
  );

  const flushPendingEditor = useCallback(() => {
    const pending = pendingEditorRef.current;
    pendingEditorRef.current = null;
    if (!pending || !mountedRef.current) return;
    editorCaptionRef.current = pending.caption;
    setPhotoEditorAsset(pending.asset);
  }, [mountedRef]);

  const handleGalleryConfirm = useCallback(
    (assets: ImagePicker.ImagePickerAsset[], caption: string) => {
      const mode = galleryMode;
      if (mode === null || assets.length === 0) return;
      setGalleryMode(null);
      if (mode === 'send') {
        sendPickedMedia(assets, caption);
        return;
      }
      // 编辑发送:编辑器点发送时再把描述跟在照片后面。
      pendingEditorRef.current = { asset: assets[0], caption };
      // iOS 要等相册完全收起才能弹编辑器(handleGalleryDismiss);安卓的弹层可以直接叠上去。
      if (Platform.OS !== 'ios') flushPendingEditor();
    },
    [flushPendingEditor, galleryMode, sendPickedMedia],
  );

  /**
   * 没有相册权限(或 Web)时的退路:系统相册不需要权限。选择器盖在应用内相册上面,
   * 选完按当前模式发送或进编辑器,带上在相册里已经填好的描述。
   */
  const handlePickFromSystem = useCallback(
    async (caption: string) => {
      const mode = galleryMode;
      // 连点两下会再唤起一次选择器,第二次直接报「已在进行中」。
      if (mode === null || systemPickerBusyRef.current) return;
      systemPickerBusyRef.current = true;
      // iOS 选视频时让系统导出成 720p H.264:旧安装包没有压缩模块,这是唯一的压缩。
      // 导出发生在选择器关掉之后、结果回来之前,长视频要十几秒,期间在顶部提示一下。
      // 新安装包上发送前压缩会认出已经是 720p H.264 的文件,不会再压一遍。
      const transcodeOnPick = Platform.OS === 'ios';
      const preparingNotice = transcodeOnPick
        ? showTopNotice({
            type: 'info',
            title: t('chat.detail.mediaPreparing', {
              defaultValue: '正在处理所选内容…',
            }),
            durationMs: 10 * 60 * 1000,
          })
        : null;
      let result: ImagePicker.ImagePickerResult;
      try {
        // 直接唤起相册:见 launchImageLibraryFast 的说明(iOS 走秒开的 PHPicker)。
        const outcome = await launchImageLibraryFast(ImagePicker, {
          mediaTypes: mode === 'edit' ? ['images'] : ['images', 'videos'],
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
          quality: 0.85,
          allowsMultipleSelection: mode === 'send',
          selectionLimit: mode === 'send' ? MAX_CHAT_IMAGE_SELECTION : 1,
          ...(transcodeOnPick
            ? { videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720 }
            : {}),
        });
        if (outcome.status === 'denied') {
          Alert.alert(t('permissions.insufficientTitle'), t('permissions.photoLibrary'));
          return;
        }
        result = outcome.result;
      } catch (error) {
        // 读不出所选文件、iOS 转码不支持这个视频编码或转码失败。调用方是 void 调用,
        // 不接住的话用户选完什么都没发生,也没有任何提示。
        reportHandledFailure('chatDetail', 'pickLibraryMedia', error);
        if (mountedRef.current) {
          setSendError(
            t('chat.detail.mediaSendFailed', {
              defaultValue: '图片或视频发送失败，请重试',
            }),
          );
        }
        return;
      } finally {
        if (preparingNotice !== null) hideTopNotice(preparingNotice);
        systemPickerBusyRef.current = false;
      }
      if (result.canceled || result.assets.length === 0) return;
      handleGalleryConfirm(result.assets, caption);
    },
    [galleryMode, handleGalleryConfirm, mountedRef, setSendError, t],
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
    editorCaptionRef.current = '';
    setPhotoEditorAsset(result.assets[0]);
  }, [isPreviewMode, sourceID, t, inFlightRef]);

  const handleSendEditedPhoto = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      let accepted = false;
      const { started, done } = chainMediaSends([asset], async (item, turn) => {
        accepted = await uploadAndSendImageAsset(item, turn);
      });
      await started;
      if (!accepted) return false;
      sendCaptionAfter(done, editorCaptionRef.current);
      editorCaptionRef.current = '';
      if (mountedRef.current) setPhotoEditorAsset(null);
      return true;
    },
    [uploadAndSendImageAsset, mountedRef, sendCaptionAfter],
  );

  const runMediaSourceAction = useCallback(
    (action: MediaSourceAction) => {
      if (!mountedRef.current) return;
      if (action === 'camera') {
        void handleTakePhoto();
        return;
      }
      if (!sourceID || isPreviewMode || inFlightRef.current) return;
      setGalleryMode(action === 'edit' ? 'edit' : 'send');
    },
    [handleTakePhoto, inFlightRef, isPreviewMode, mountedRef, sourceID],
  );

  const handleMediaSourceSelect = useCallback(
    (action: MediaSourceAction) => {
      setMediaSourceSheetVisible(false);
      if (Platform.OS === 'ios') {
        // 面板还在收起时弹不出下一个全屏层:等它的 onDismiss(handleMediaSourceSheetDismiss)。
        pendingSourceActionRef.current = action;
        return;
      }
      requestAnimationFrame(() => runMediaSourceAction(action));
    },
    [runMediaSourceAction],
  );

  const handleMediaSourceSheetDismiss = useCallback(() => {
    const action = pendingSourceActionRef.current;
    pendingSourceActionRef.current = null;
    if (action) runMediaSourceAction(action);
  }, [runMediaSourceAction]);

  return {
    mediaSourceSheetVisible,
    setMediaSourceSheetVisible,
    handleMediaSourceSelect,
    handleMediaSourceSheetDismiss,
    galleryMode,
    setGalleryMode,
    handleGalleryConfirm,
    handleGalleryDismiss: flushPendingEditor,
    handlePickFromSystem,
    photoEditorAsset,
    setPhotoEditorAsset,
    handleSendEditedPhoto,
  };
}
