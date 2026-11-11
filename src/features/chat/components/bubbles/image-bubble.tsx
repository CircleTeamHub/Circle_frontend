import { isEphemeralMessage } from '@/features/chat/utils/ephemeral-message';
import { messageRowKey } from '@/chat-core/local-message-id';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, type GestureResponderEvent } from 'react-native';
import { MediaImage } from '@/components/ui/media-image';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import type { ChatMessage } from '@/types';
import { BubbleStatusText, MessageAvatar } from './shared';
import { reportHandledFailure } from '@/observability/report-failure';
import { ImageViewer } from '@/components/ui/image-viewer';
import { useEphemeralImageDiskCacheSweep } from './ephemeral-image-cache';
import { MediaUploadProgress } from './media-upload-progress';
import { ExpiredMediaPlaceholder } from './expired-media-placeholder';

interface ImageBubbleProps {
  message: ChatMessage;
  getGalleryMessages?: () => ChatMessage[];
  subscribeGalleryMessages?: (listener: () => void) => () => void;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  onAvatarLongPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
  selfDestructEnabled?: boolean;
  selfDestructCacheKey?: string;
  onImagePress?: (message: ChatMessage) => void;
}

/** 本机文件等本地地址:不挂存储 key 当缓存键,免得把本地原片记在远端那张的名下。 */
const LOCAL_URI = /^(?:file|content|ph|assets-library|data|blob):/i;

/**
 * 远端图片的缓存键用存储 object key:签名地址每小时轮换,按地址缓存的话同一张图
 * 过了窗口就整张重新下载。
 */
function remoteCacheKey(
  uri: string | undefined,
  key: string | undefined,
): string | undefined {
  return uri && key && !LOCAL_URI.test(uri) ? key : undefined;
}
const sImage = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: {
    justifyContent: 'flex-end',
  },
  body: {
    maxWidth: 240,
  },
  bodyOutgoing: {
    alignItems: 'flex-end',
  },
  imageWrap: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  image: {
    width: 220,
    height: 220,
  },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

export const ImageBubble: React.FC<ImageBubbleProps> = ({
  message,
  getGalleryMessages,
  subscribeGalleryMessages,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  onAvatarLongPress,
  onLongPress,
  hideStatus,
  selfDestructEnabled = false,
  selfDestructCacheKey = '',
  onImagePress,
}) => {
  const { colors } = useTheme();
  // Only this message’s author-stamped duration controls media retention.
  const ephemeral = isEphemeralMessage(message, selfDestructEnabled);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [galleryMessages, setGalleryMessages] = useState<ChatMessage[]>([]);
  const previewPolicyRef = useRef(`${ephemeral}:${selfDestructCacheKey}`);
  const avatarNode = (
    <MessageAvatar
      message={message}
      outgoing={outgoing}
      selfName={selfName}
      selfAvatarUri={selfAvatarUri}
      senderName={senderName}
      senderAvatarUri={senderAvatarUri}
      onPress={outgoing ? onAvatarPress : undefined}
    />
  );

  const dimensions = useMemo(() => {
    if (!message.imageWidth || !message.imageHeight) {
      return { width: 220, height: 220 };
    }
    const maxSide = 220;
    const ratio = message.imageWidth / message.imageHeight;
    return ratio >= 1
      ? { width: maxSide, height: Math.round(maxSide / ratio) }
      : { width: Math.round(maxSide * ratio), height: maxSide };
  }, [message.imageHeight, message.imageWidth]);

  // 首次在这个焚毁策略下看到它时清一次磁盘缓存(见 ephemeral-image-cache)。
  useEphemeralImageDiskCacheSweep(ephemeral, selfDestructCacheKey);

  useEffect(() => {
    const policy = `${ephemeral}:${selfDestructCacheKey}`;
    if (previewPolicyRef.current !== policy) {
      previewPolicyRef.current = policy;
      setPreviewVisible(false);
    }
  }, [ephemeral, selfDestructCacheKey]);

  useEffect(() => {
    if (!previewVisible || !subscribeGalleryMessages) return;
    const refresh = () => {
      const liveMessages = getGalleryMessages?.() ?? [message];
      setGalleryMessages((current) => {
        // Keep the page opened by the user, but replace its snapshots with live messages.
        const openedKeys = new Set(current.map(messageRowKey));
        return liveMessages.filter((item) => openedKeys.has(messageRowKey(item)));
      });
    };
    const unsubscribe = subscribeGalleryMessages(refresh);
    refresh();
    return unsubscribe;
  }, [getGalleryMessages, message, previewVisible, subscribeGalleryMessages]);

  // 列表气泡优先渲染缩略图；缺失时回退到原图。原图查看留给点击放大流程。
  const displayUri = message.imageThumbUrl ?? message.imageUrl;
  const previewUri = message.imageUrl ?? displayUri;
  const displayCacheKey = remoteCacheKey(
    displayUri,
    message.imageThumbUrl ? message.imageThumbKey : message.imageKey,
  );
  const previewMessages = useMemo(() => {
    if (!previewVisible || ephemeral) return [message];
    const photos = galleryMessages.filter((item) =>
      item.type === 'image' &&
      (item.imageUrl || item.imageThumbUrl) &&
      !isEphemeralMessage(item, selfDestructEnabled),
    );
    return photos.some((item) => messageRowKey(item) === messageRowKey(message)) ? photos : [message];
  }, [ephemeral, galleryMessages, message, previewVisible, selfDestructEnabled]);
  const handleOpenPreview = useCallback(() => {
    if (!previewUri) return;
    if (onImagePress) onImagePress(message);
    else {
      setGalleryMessages(getGalleryMessages?.() ?? [message]);
      setPreviewVisible(true);
    }
  }, [getGalleryMessages, message, onImagePress, previewUri]);
  const imageNode = (
    <View style={[sImage.body, outgoing ? sImage.bodyOutgoing : null]}>
      <View style={sImage.imageWrap}>
        <Pressable
          testID="chat-image-preview"
          onPress={handleOpenPreview}
          onLongPress={onLongPress}
          delayLongPress={350}
        >
          {message.mediaExpired ? (
            <ExpiredMediaPlaceholder kind="image" style={dimensions} />
          ) : displayUri ? (
            <MediaImage
              source={
                displayCacheKey
                  ? { uri: displayUri, cacheKey: displayCacheKey }
                  : { uri: displayUri }
              }
              style={[sImage.image, dimensions]}
              contentFit="cover"
              cachePolicy={ephemeral ? 'memory' : 'memory-disk'}
              // 图片尺寸由对端决定，本地无从预判。Android 走 Glide 会读图片头、按目标
              // 尺寸挑 inSampleSize，超大图只是多下载一些字节；iOS 不会——不开这个开关
              // 时 expo-image 会把整张位图解进内存，一张 20000x20000 就是 ~1.6GB，直接
              // OOM 崩溃。这是 iOS-only 的 prop，在 Android 上是无害的空操作，所以现在
              // 就加上，而不是等真正出 iOS 包时再补（那时容易漏）。
              enforceEarlyResizing
              onError={(event) => {
                reportHandledFailure(
                  'chatMedia',
                  'imageLoad',
                  new Error(event.error),
                );
              }}
            />
          ) : null}
        </Pressable>
        {outgoing && message.sendStatus === 1 && message.deliveryId ? (
          <MediaUploadProgress deliveryId={message.deliveryId} kind="image" />
        ) : null}
      </View>
      {message.time ? (
        <View style={sImage.timeRow}>
          <Text
            style={{
              ...Typography.tinyRegular,
              color: colors.text,
            }}
          >
            {message.time}
          </Text>
          {outgoing && !hideStatus ? <BubbleStatusText message={message} /> : null}
        </View>
      ) : null}
    </View>
  );
  // The viewer contains a native Modal and a FlatList. Keeping one hidden
  // viewer mounted for every virtualized image row makes a burst of images
  // allocate dozens of native modal/list trees even though only one can be
  // open. Mount it only for the image the user is actively previewing.
  const imageViewer = previewVisible ? (
    <ImageViewer
      // A removed photo invalidates the viewer's page index and any open save menu.
      key={JSON.stringify(previewMessages.map(messageRowKey))}
      images={previewMessages.map((item) => (item.imageUrl ?? item.imageThumbUrl)!)}
      cacheKeys={previewMessages.map((item) => remoteCacheKey(
        item.imageUrl ?? item.imageThumbUrl,
        item.imageUrl ? item.imageKey : item.imageThumbKey,
      ))}
      initialIndex={Math.max(0, previewMessages.findIndex((item) => messageRowKey(item) === messageRowKey(message)))}
      visible
      privacyMode={ephemeral ? 'ephemeral' : 'standard'}
      onClose={() => setPreviewVisible(false)}
    />
  ) : null;

  if (outgoing) {
    return (
      <>
        <View style={[sImage.row, sImage.rowOutgoing]}>
          {imageNode}
          <View style={sImage.avatarSlot}>{avatarNode}</View>
        </View>
        {imageViewer}
      </>
    );
  }

  return (
    <>
      <View style={sImage.row}>
        {onAvatarPress || onAvatarLongPress ? (
          <Pressable style={sImage.avatarSlot} onPress={onAvatarPress} onLongPress={onAvatarLongPress} delayLongPress={350}>
            {avatarNode}
          </Pressable>
        ) : (
          <View style={sImage.avatarSlot}>{avatarNode}</View>
        )}
        {imageNode}
      </View>
      {imageViewer}
    </>
  );
};
