import { createContext, useContext, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { ChatMessage, NoteCardData } from '@/types';
import { isEphemeralMessage } from '@/features/chat/utils/ephemeral-message';
import {
  canOpenQuotedMedia,
  quoteDisplayText,
  quoteThumbnail,
  type QuoteThumbnail,
} from '@/features/chat/utils/quote-preview';
import { remoteCacheKey } from './media-cache-key';
import type { NoteCardSection } from './note-card-body';
import { QuotedNoteCard } from './quoted-note-card';

/**
 * 当前聊天页里被引用到的原消息。走 context 而不是气泡 props:原消息随翻页才到,
 * 放进行渲染函数的依赖里会让每来一条消息整列气泡都重渲染,context 只叫醒引用块。
 */
export interface QuoteSources {
  byId: ReadonlyMap<string, ChatMessage>;
  openMedia?: (message: ChatMessage) => void;
  /** 点引用块里展开的笔记卡片,行为与聊天里那张原卡片相同。 */
  openNoteCard?: (message: ChatMessage, note: NoteCardData, section?: NoteCardSection | '') => void;
  /** 会话级阅后即焚(老后端消息不带逐条时长时的回落)。 */
  selfDestructEnabled: boolean;
}

const NO_QUOTE_SOURCES: QuoteSources = { byId: new Map(), selfDestructEnabled: false };

export const QuoteSourcesContext = createContext<QuoteSources>(NO_QUOTE_SOURCES);

/** 收集 messages 里被引用到的原消息(撤回/日期这类没有内容可展示的不收)。 */
export function collectQuoteSources(messages: readonly ChatMessage[]): Map<string, ChatMessage> {
  const wanted = new Set<string>();
  for (const message of messages) {
    if (message.quoteMessageId && !message.quoteRevoked) wanted.add(message.quoteMessageId);
  }
  const byId = new Map<string, ChatMessage>();
  if (wanted.size === 0) return byId;
  for (const message of messages) {
    if (wanted.has(message.id) && message.type !== 'system-notice' && message.type !== 'date') {
      byId.set(message.id, message);
    }
  }
  return byId;
}

const THUMB_SIZE = 40;

interface QuoteThumbnailImageProps {
  thumb: QuoteThumbnail;
  ephemeral: boolean;
  size?: number;
}

/** 引用缩略图。阅后即焚的原图只进内存缓存,与原气泡同一条规则,不因引用落盘。 */
export const QuoteThumbnailImage: React.FC<QuoteThumbnailImageProps> = ({
  thumb,
  ephemeral,
  size = THUMB_SIZE,
}) => {
  const { colors } = useTheme();
  const cacheKey = remoteCacheKey(thumb.uri, thumb.key);
  const frame = useMemo(
    () => ({ width: size, height: size, backgroundColor: colors.surfaceBorder }),
    [colors.surfaceBorder, size],
  );
  return (
    <View testID="quote-thumbnail" style={[s.thumb, frame]}>
      <Image
        source={cacheKey ? { uri: thumb.uri, cacheKey } : { uri: thumb.uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy={ephemeral ? 'memory' : 'memory-disk'}
        transition={0}
        // 没有缩略图时回落的是原图;iOS 不开这个会把整张位图解进内存。
        enforceEarlyResizing
      />
      {thumb.video ? (
        <View style={[s.playBadge, { backgroundColor: colors.overlay }]}>
          <Ionicons name="play" size={12} color={colors.white} />
        </View>
      ) : null}
    </View>
  );
};

interface QuotedMessageBlockProps {
  message: ChatMessage;
  /** 跟着气泡贴边:自己发的靠右,收到的靠左。 */
  align: 'start' | 'end';
  /** 点文字定位到原消息;原消息不可达时不传。 */
  onPress?: () => void;
}

/**
 * 气泡下方的引用块(微信式):灰底小卡片,左边「发送者: 摘要」,右边原消息的缩略图
 * (图片 / 视频 / 活动封面);引用笔记时整张笔记卡片展开。原消息不在本页时退回
 * 服务端快照那行文字。点缩略图直接看大图,点文字定位原消息。
 */
export const QuotedMessageBlock: React.FC<QuotedMessageBlockProps> = ({
  message,
  align,
  onPress,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { byId, openMedia, openNoteCard, selfDestructEnabled } = useContext(QuoteSourcesContext);
  const themed = useMemo(
    () => ({
      box: { backgroundColor: colors.quoteBlock },
      text: { color: colors.quoteBlockText },
    }),
    [colors.quoteBlock, colors.quoteBlockText],
  );
  const source =
    message.quoteMessageId && !message.quoteRevoked
      ? byId.get(message.quoteMessageId)
      : undefined;
  // 引用的是笔记:整张卡片原样展开(标题、四宫格、分块按钮都能点),不缩成一行摘要。
  if (source?.type === 'note-card' && source.noteCard) {
    return (
      <QuotedNoteCard
        source={source}
        note={source.noteCard}
        senderName={message.quoteSenderName}
        align={align}
        onPress={onPress}
        onOpenNote={openNoteCard}
      />
    );
  }
  const text = quoteDisplayText(message, source, t);
  const thumb = source ? quoteThumbnail(source) : null;
  if (!text && !thumb) return null;

  const thumbNode =
    source && thumb ? (
      <QuoteThumbnailImage
        thumb={thumb}
        ephemeral={isEphemeralMessage(source, selfDestructEnabled)}
      />
    ) : null;
  const body = (
    <>
      {text ? (
        <Text style={[s.text, themed.text]} numberOfLines={2}>
          {text}
        </Text>
      ) : null}
      {thumbNode && source && openMedia && canOpenQuotedMedia(source) ? (
        <Pressable
          onPress={() => openMedia(source)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={
            source.type === 'video'
              ? t('chat.detail.playVideo', { defaultValue: '播放视频' })
              : t('chat.detail.openImage', { defaultValue: '查看图片' })
          }
        >
          {thumbNode}
        </Pressable>
      ) : (
        thumbNode
      )}
    </>
  );
  const boxStyle = [s.box, align === 'end' ? s.alignEnd : s.alignStart, themed.box];
  return onPress ? (
    <Pressable testID="quote-block" style={boxStyle} onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    <View testID="quote-block" style={boxStyle}>
      {body}
    </View>
  );
};

// 尺寸按微信截图量的:离气泡 4、左右 12、上下 8,缩略图 40,字与气泡正文同号。
const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.xs,
    paddingHorizontal: 12,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
    maxWidth: 280,
  },
  alignStart: { alignSelf: 'flex-start' },
  alignEnd: { alignSelf: 'flex-end' },
  text: {
    flexShrink: 1,
    ...Typography.bodyRegular,
    lineHeight: 20,
  },
  thumb: {
    borderRadius: Radius.xs,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
