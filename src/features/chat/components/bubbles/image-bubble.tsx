import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import type { ChatMessage } from '@/types';
import { BubbleStatusText, MessageAvatar } from './shared';
import { reportHandledFailure } from '@/observability/report-failure';
import { ImageViewer } from '@/components/ui/image-viewer';

interface ImageBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
  selfDestructEnabled?: boolean;
  selfDestructCacheKey?: string;
}

let diskCacheClearedForSelfDestructKey: string | null = null;

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
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  onLongPress,
  hideStatus,
  selfDestructEnabled = false,
  selfDestructCacheKey = '',
}) => {
  const { colors } = useTheme();
  // 消息自己带的焚毁秒数优先于屏幕级判定。屏幕级那个是从会话列表缓存算的，
  // 推送冷启动时列表可能还没到，查不到就会读成「没开焚毁」，于是这张该焚毁的
  // 图片按普通图片渲染：原图落盘、长按可存相册。等缓存补齐再翻转已经晚了。
  // 消息上的值由服务端逐条下发，不依赖任何加载顺序；老后端不发时为 undefined，
  // 此时仍回落到屏幕级判定，行为与升级前一致。
  const ephemeral = (message.burnDurationSec ?? 0) > 0 || selfDestructEnabled;
  const [previewVisible, setPreviewVisible] = useState(false);
  const previewPolicyRef = useRef(`${ephemeral}:${selfDestructCacheKey}`);
  const avatarNode = (
    <MessageAvatar
      message={message}
      outgoing={outgoing}
      selfName={selfName}
      selfAvatarUri={selfAvatarUri}
      senderName={senderName}
      senderAvatarUri={senderAvatarUri}
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

  useEffect(() => {
    if (
      !ephemeral ||
      diskCacheClearedForSelfDestructKey === selfDestructCacheKey
    ) {
      return;
    }
    diskCacheClearedForSelfDestructKey = selfDestructCacheKey;
    // expo-image 不能按 URI 移除已落盘内容；首次启用阅后即焚时清一次磁盘缓存，
    // 确保此前的聊天图片不会绕过后续的内存缓存策略。
    void Image.clearDiskCache().catch(() => undefined);
    void Image.clearMemoryCache().catch(() => undefined);
  }, [ephemeral, selfDestructCacheKey]);

  useEffect(() => {
    const policy = `${ephemeral}:${selfDestructCacheKey}`;
    if (previewPolicyRef.current !== policy) {
      previewPolicyRef.current = policy;
      setPreviewVisible(false);
    }
  }, [ephemeral, selfDestructCacheKey]);

  // 列表气泡优先渲染缩略图；缺失时回退到原图。原图查看留给点击放大流程。
  const displayUri = message.imageThumbUrl ?? message.imageUrl;
  const previewUri = message.imageUrl ?? displayUri;
  const handleOpenPreview = useCallback(() => {
    if (previewUri) setPreviewVisible(true);
  }, [previewUri]);
  const imageNode = (
    <View style={[sImage.body, outgoing ? sImage.bodyOutgoing : null]}>
      <Pressable
        style={sImage.imageWrap}
        onPress={handleOpenPreview}
        onLongPress={onLongPress}
        delayLongPress={350}
      >
        {displayUri ? (
          <Image
            source={{ uri: displayUri }}
            style={[sImage.image, dimensions]}
            contentFit="cover"
            transition={150}
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
      {message.time ? (
        <View style={sImage.timeRow}>
          <Text
            style={{
              ...Typography.tinyRegular,
              color: colors.textSecondary,
            }}
          >
            {message.time}
          </Text>
          {outgoing && !hideStatus ? <BubbleStatusText message={message} /> : null}
        </View>
      ) : null}
    </View>
  );

  if (outgoing) {
    return (
      <>
        <View style={[sImage.row, sImage.rowOutgoing]}>
          {imageNode}
          <View style={sImage.avatarSlot}>{avatarNode}</View>
        </View>
        <ImageViewer
          images={previewUri ? [previewUri] : []}
          visible={previewVisible}
          privacyMode={ephemeral ? 'ephemeral' : 'standard'}
          onClose={() => setPreviewVisible(false)}
        />
      </>
    );
  }

  return (
    <>
      <View style={sImage.row}>
        {onAvatarPress ? (
          <Pressable style={sImage.avatarSlot} onPress={onAvatarPress}>
            {avatarNode}
          </Pressable>
        ) : (
          <View style={sImage.avatarSlot}>{avatarNode}</View>
        )}
        {imageNode}
      </View>
      <ImageViewer
        images={previewUri ? [previewUri] : []}
        visible={previewVisible}
        privacyMode={ephemeral ? 'ephemeral' : 'standard'}
        onClose={() => setPreviewVisible(false)}
      />
    </>
  );
};
