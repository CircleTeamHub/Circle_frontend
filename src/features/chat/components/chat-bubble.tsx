import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, type AudioStatus } from 'expo-audio';
import { useTranslation } from 'react-i18next';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import { toPlayableUri } from '@/im/media-uri';
import type {
  ChatMessage,
  FriendCardData,
  CircleCardData,
  NoteCardData,
  TransferCardData,
} from '@/types';

interface DatePillProps {
  text: string;
}

const sDatePill = StyleSheet.create({
  datePillWrapper: {
    alignItems: 'center',
  },
  datePill: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.xs,
    paddingHorizontal: 14,
  },
});

export const DatePill: React.FC<DatePillProps> = ({ text }) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      datePill: {
        backgroundColor: colors.surface,
      },
      datePillText: {
        color: colors.textSecondary,
        ...Typography.small,
      },
    }),
    [colors],
  );

  return (
    <View style={sDatePill.datePillWrapper}>
      <View style={[sDatePill.datePill, d.datePill]}>
        <Text style={d.datePillText}>{text}</Text>
      </View>
    </View>
  );
};

interface ReceivedBubbleProps {
  message: ChatMessage;
  senderName?: string;
  senderAvatarUri?: string;
  onAvatarPress?: () => void;
}

const AVATAR_SIZE = 36;

interface BubbleStatusTextProps {
  message: ChatMessage;
}

/**
 * 自己发出去的消息底下显示状态文字：发送中 / 未读 / 已读 / 发送失败。
 * 接收消息不显示状态。
 */
export const BubbleStatusText: React.FC<BubbleStatusTextProps> = ({ message }) => {
  const { colors } = useTheme();
  const { sendStatus, isRead } = message;
  let text: string;
  let color = colors.textSecondary;
  if (sendStatus === 1) {
    text = '发送中';
  } else if (sendStatus === 3) {
    text = '发送失败';
    color = colors.error;
  } else if (isRead) {
    text = '已读';
  } else {
    text = '未读';
  }
  return (
    <Text style={{ ...Typography.tinyRegular, color, marginLeft: 4 }}>
      {text}
    </Text>
  );
};

const sReceived = StyleSheet.create({
  receivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  receivedBubble: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxWidth: 280,
  },
  receivedContent: {
    maxWidth: 280,
  },
  receivedAvatarSlot: {
    paddingBottom: 2,
  },
});

export const ReceivedBubble: React.FC<ReceivedBubbleProps> = ({
  message,
  // 缺省值之前写死成 '陈' —— 一旦后端漏传 senderNickname，每个聊天都会显示 "陈"。
  // 空字符串让 Avatar 自身回退到首字母 / 图标占位。
  senderName = '',
  senderAvatarUri,
  onAvatarPress,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      receivedBubble: {
        backgroundColor: colors.receivedBubble,
      },
      bubbleText: {
        color: colors.text,
        ...Typography.bodyRegular,
        lineHeight: 20,
      },
      timeText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
    }),
    [colors],
  );

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={senderName}
      uri={senderAvatarUri}
    />
  );

  return (
    <View style={sReceived.receivedRow}>
      {onAvatarPress ? (
        <Pressable style={sReceived.receivedAvatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sReceived.receivedAvatarSlot}>{avatarNode}</View>
      )}
      <View style={sReceived.receivedContent}>
        <View style={[sReceived.receivedBubble, d.receivedBubble]}>
          <Text style={d.bubbleText}>{message.text}</Text>
        </View>
        {message.time ? (
          <Text style={d.timeText}>{message.time}</Text>
        ) : null}
      </View>
    </View>
  );
};

interface SentBubbleProps {
  message: ChatMessage;
  selfName?: string;
  selfAvatarUri?: string;
  hideStatus?: boolean;
}

const sSent = StyleSheet.create({
  sentRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  sentContent: {
    alignItems: 'flex-end',
    maxWidth: 280,
  },
  sentBubble: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxWidth: 280,
  },
  sentAvatarSlot: {
    paddingBottom: 2,
  },
  sentTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  sentStatusIcon: {
    marginTop: 1,
  },
});

export const SentBubble: React.FC<SentBubbleProps> = ({
  message,
  selfName,
  selfAvatarUri,
  hideStatus,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      sentBubble: {
        backgroundColor: colors.sentBubble,
      },
      sentBubbleText: {
        color: colors.white,
        ...Typography.bodyRegular,
        lineHeight: 20,
      },
      timeText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
    }),
    [colors],
  );

  return (
    <View style={sSent.sentRow}>
      <View style={sSent.sentContent}>
        <View style={[sSent.sentBubble, d.sentBubble]}>
          <Text style={d.sentBubbleText}>{message.text}</Text>
        </View>
        {message.time ? (
          <View style={sSent.sentTimeRow}>
            <Text style={d.timeText}>{message.time}</Text>
            {hideStatus ? null : <BubbleStatusText message={message} />}
          </View>
        ) : null}
      </View>
      <View style={sSent.sentAvatarSlot}>
        <Avatar
          size={AVATAR_SIZE}
          shape="square"
          name={selfName}
          uri={selfAvatarUri}
        />
      </View>
    </View>
  );
};

interface LocationCardProps {
  message: ChatMessage;
  outgoing?: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
}

const sLocation = StyleSheet.create({
  receivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: {
    justifyContent: 'flex-end',
  },
  locationCard: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
    width: 248,
    overflow: 'hidden',
  },
  locationImage: {
    height: 156,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  locationImageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationCardBody: {
    maxWidth: 248,
  },
  locationCardContent: {
    minHeight: 88,
    justifyContent: 'center',
  },
  locationInfo: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
});

export const LocationCard: React.FC<LocationCardProps> = ({
  message,
  outgoing = false,
  // 同 ReceivedBubble：删除 '陈' 默认值。
  senderName = '',
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      locationCard: {
        backgroundColor: colors.receivedBubble,
      },
      locationImageFallback: {
        backgroundColor: colors.surface,
      },
      locationTitle: {
        color: colors.text,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      locationAddress: {
        color: colors.textSecondary,
        ...Typography.small,
        marginTop: 2,
      },
      timeText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
    }),
    [colors],
  );

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const cardNode = (
    <View style={sLocation.locationCardBody}>
      <View style={[sLocation.locationCard, d.locationCard]}>
        <View style={sLocation.locationImage}>
          <View style={[sLocation.locationImageFallback, d.locationImageFallback]}>
            <Ionicons name="location" size={32} color={colors.textSecondary} />
          </View>
        </View>
        <View style={[sLocation.locationInfo, sLocation.locationCardContent]}>
          <Text style={d.locationTitle}>{message.locationTitle}</Text>
          <Text style={d.locationAddress}>{message.locationAddress}</Text>
        </View>
      </View>
      {message.time ? <Text style={d.timeText}>{message.time}</Text> : null}
    </View>
  );

  if (outgoing) {
    return (
      <View style={[sLocation.receivedRow, sLocation.rowOutgoing]}>
        {cardNode}
        <View style={sReceived.receivedAvatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sLocation.receivedRow}>
      {onAvatarPress ? (
        <Pressable style={sReceived.receivedAvatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sReceived.receivedAvatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};

interface ImageBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
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
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
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

  const imageNode = (
    <View style={[sImage.body, outgoing ? sImage.bodyOutgoing : null]}>
      <View style={sImage.imageWrap}>
        {message.imageUrl ? (
          <Image
            source={{ uri: message.imageUrl }}
            style={[sImage.image, dimensions]}
            contentFit="cover"
            onError={(event) => {
              if (__DEV__) {
                console.warn('[chat] image load failed', {
                  uri: message.imageUrl,
                  error: event.error,
                });
              }
            }}
          />
        ) : null}
      </View>
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
      <View style={[sImage.row, sImage.rowOutgoing]}>
        {imageNode}
        <View style={sImage.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
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
  );
};

interface VoiceBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

const sVoice = StyleSheet.create({
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
  bubble: {
    minWidth: 96,
    maxWidth: 220,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bubbleOutgoing: {
    borderBottomRightRadius: 4,
  },
  bubbleIncoming: {
    borderTopLeftRadius: 4,
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  bar: {
    width: 3,
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  avatarSlot: { paddingBottom: 2 },
});

function formatVoiceDuration(duration?: number) {
  const seconds = Math.max(1, Math.round(duration ?? 1));
  return `${seconds}"`;
}

export const VoiceBubble: React.FC<VoiceBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const voiceSource = message.voiceUrl || message.voicePath || null;
  // 裸本地路径要补回 file:// scheme，否则 AVFoundation 打不开（FigFilePlayer err=-12864）。
  const player = useAudioPlayer(voiceSource ? { uri: toPlayableUri(voiceSource) } : null);
  const [isPlaying, setIsPlaying] = useState(false);
  const bubbleColor = outgoing ? colors.sentBubble : colors.receivedBubble;
  const contentColor = outgoing ? colors.white : colors.text;

  useEffect(() => {
    setIsPlaying(false);
    const subscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      setIsPlaying(Boolean(status.playing));
    });
    return () => {
      subscription.remove();
    };
  }, [player, voiceSource]);

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const voiceNode = (
    <View style={[sVoice.body, outgoing ? sVoice.bodyOutgoing : null]}>
      <Pressable
        style={[
          sVoice.bubble,
          { backgroundColor: bubbleColor },
          outgoing ? sVoice.bubbleOutgoing : sVoice.bubbleIncoming,
          !voiceSource ? { opacity: 0.64 } : null,
        ]}
        onPress={() => {
          if (!voiceSource) return;
          if (isPlaying) {
            player.pause();
            return;
          }
          void player.seekTo(0).then(() => player.play());
        }}
        accessibilityRole="button"
        accessibilityLabel="播放语音消息"
        disabled={!voiceSource}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'chatbubble-ellipses'}
          size={18}
          color={contentColor}
        />
        <View style={sVoice.wave}>
          {[10, 16, 22, 14].map((height, index) => (
            <View
              key={index}
              style={[
                sVoice.bar,
                {
                  height,
                  backgroundColor: contentColor,
                  opacity: index === 0 || index === 3 ? 0.55 : 0.85,
                },
              ]}
            />
          ))}
        </View>
        <Text style={{ ...Typography.small, color: contentColor }}>
          {formatVoiceDuration(message.voiceDuration)}
        </Text>
      </Pressable>
      {message.time ? (
        <View style={sVoice.timeRow}>
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
      <View style={[sVoice.row, sVoice.rowOutgoing]}>
        {voiceNode}
        <View style={sVoice.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sVoice.row}>
      {onAvatarPress ? (
        <Pressable style={sVoice.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sVoice.avatarSlot}>{avatarNode}</View>
      )}
      {voiceNode}
    </View>
  );
};

interface NoteCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (note: NoteCardData) => void;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

const sNote = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: {
    justifyContent: 'flex-end',
  },
  body: {
    maxWidth: 260,
  },
  bodyOutgoing: {
    alignItems: 'flex-end',
  },
  card: {
    width: 260,
    borderRadius: Radius.md,
    overflow: 'hidden',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  cover: {
    width: 64,
    height: 64,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: { ...Typography.body, fontWeight: '600' },
  preview: { ...Typography.small, lineHeight: 18 },
  meta: {
    ...Typography.tinyRegular,
    marginTop: Spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  chipText: { ...Typography.small, fontWeight: '600' },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

const NOTE_CARD_GREEN = '#4ADE80';

export const NoteCardBubble: React.FC<NoteCardBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onPress,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const note = message.noteCard;

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  if (!note) return null;

  // 4 个标签：笔记 / 视频 / 展示 / 位置 —— 笔记内容包含哪一项就显示绿色
  const flags = {
    note: Boolean(note.contentPreview && note.contentPreview.trim()),
    video: note.videoCount > 0,
    display: note.imageCount > 0,
    location: note.groupNames.length > 0,
  };

  const chips: { id: keyof typeof flags; label: string }[] = [
    { id: 'note', label: '笔记' },
    { id: 'video', label: '视频' },
    { id: 'display', label: '展示' },
    { id: 'location', label: '位置' },
  ];

  const metaSegments: string[] = [];
  if (note.imageCount > 0) metaSegments.push(`${note.imageCount}张图片`);
  if (note.videoCount > 0) metaSegments.push(`${note.videoCount}个视频`);
  const metaLine = metaSegments.length ? `包含: ${metaSegments.join('|')}` : null;

  const cardBg = outgoing ? colors.sentBubble : colors.receivedBubble;
  const onCardColor = outgoing ? colors.white : colors.text;
  const onCardSecondary = outgoing
    ? 'rgba(255,255,255,0.78)'
    : colors.textSecondary;

  const cardNode = (
    <View style={[sNote.body, outgoing ? sNote.bodyOutgoing : null]}>
      <Pressable
        style={[sNote.card, { backgroundColor: cardBg }]}
        onPress={onPress ? () => onPress(note) : undefined}
      >
        <View style={sNote.topRow}>
          {note.coverUrl ? (
            <Image
              source={{ uri: note.coverUrl }}
              style={sNote.cover}
              contentFit="cover"
            />
          ) : (
            <View style={[sNote.cover, { alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="document-text-outline" size={28} color={onCardSecondary} />
            </View>
          )}
          <View style={sNote.textCol}>
            <Text style={[sNote.title, { color: onCardColor }]} numberOfLines={1}>
              {note.title}
            </Text>
            {note.contentPreview ? (
              <Text
                style={[sNote.preview, { color: onCardSecondary }]}
                numberOfLines={3}
              >
                {note.contentPreview}
              </Text>
            ) : null}
          </View>
        </View>

        {metaLine ? (
          <Text style={[sNote.meta, { color: onCardSecondary }]}>{metaLine}</Text>
        ) : null}

        <View style={sNote.chips}>
          {chips.map((chip) => {
            const active = flags[chip.id];
            return (
              <View
                key={chip.id}
                style={[
                  sNote.chip,
                  {
                    backgroundColor: active
                      ? NOTE_CARD_GREEN
                      : 'transparent',
                    borderColor: active ? NOTE_CARD_GREEN : onCardSecondary,
                  },
                ]}
              >
                <Text
                  style={[
                    sNote.chipText,
                    { color: active ? colors.white : onCardSecondary },
                  ]}
                >
                  {chip.label}
                </Text>
              </View>
            );
          })}
        </View>
      </Pressable>

      {message.time ? (
        <View style={sNote.timeRow}>
          <Text
            style={{ ...Typography.tinyRegular, color: colors.textSecondary }}
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
      <View style={[sNote.row, sNote.rowOutgoing]}>
        {cardNode}
        <View style={sNote.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sNote.row}>
      {onAvatarPress ? (
        <Pressable style={sNote.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sNote.avatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};

interface FriendCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (card: FriendCardData) => void;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

const sFriendCard = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: { justifyContent: 'flex-end' },
  body: { maxWidth: 260 },
  bodyOutgoing: { alignItems: 'flex-end' },
  card: {
    width: 260,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  textCol: { flex: 1, gap: 2 },
  nickname: { ...Typography.body, fontWeight: '600' },
  persona: { ...Typography.small, lineHeight: 18 },
  iconsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  iconChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    gap: 4,
  },
  iconImage: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  iconLabel: { ...Typography.tiny, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginTop: Spacing.xs },
  footer: { ...Typography.tinyRegular, paddingTop: 4 },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

export const FriendCardBubble: React.FC<FriendCardBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onPress,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const card = message.friendCard;
  if (!card) return null;

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const cardBg = outgoing ? colors.sentBubble : colors.receivedBubble;
  const onCardColor = outgoing ? colors.white : colors.text;
  const onCardSecondary = outgoing
    ? 'rgba(255,255,255,0.78)'
    : colors.textSecondary;
  const dividerColor = outgoing ? 'rgba(255,255,255,0.25)' : colors.divider;

  const cardNode = (
    <View style={[sFriendCard.body, outgoing ? sFriendCard.bodyOutgoing : null]}>
      <Pressable
        style={[sFriendCard.card, { backgroundColor: cardBg }]}
        onPress={onPress ? () => onPress(card) : undefined}
      >
        <View style={sFriendCard.topRow}>
          <Avatar
            size={48}
            shape="square"
            name={card.nickname}
            uri={card.faceURL || undefined}
          />
          <View style={sFriendCard.textCol}>
            <Text
              style={[sFriendCard.nickname, { color: onCardColor }]}
              numberOfLines={1}
            >
              {card.nickname}
            </Text>
            <Text
              style={[sFriendCard.persona, { color: onCardSecondary }]}
              numberOfLines={2}
            >
              {card.persona?.trim() || '这个人很懒，什么都没留下'}
            </Text>
          </View>
        </View>
        {card.displayIcons && card.displayIcons.length > 0 ? (
          <View style={sFriendCard.iconsRow}>
            {card.displayIcons.slice(0, 4).map((icon) => {
              const iconBg = outgoing ? 'rgba(255,255,255,0.18)' : colors.surface;
              return (
                <View
                  key={icon.id}
                  style={[sFriendCard.iconChip, { backgroundColor: iconBg }]}
                >
                  {icon.imageUrl ? (
                    <Image
                      source={{ uri: icon.imageUrl }}
                      style={sFriendCard.iconImage}
                      contentFit="cover"
                    />
                  ) : (
                    <Ionicons
                      name={
                        (icon.fallbackIconName as keyof typeof Ionicons.glyphMap) ??
                        'ribbon-outline'
                      }
                      size={14}
                      color={onCardColor}
                    />
                  )}
                  <Text
                    style={[sFriendCard.iconLabel, { color: onCardColor }]}
                    numberOfLines={1}
                  >
                    {icon.title}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
        <View style={[sFriendCard.divider, { backgroundColor: dividerColor }]} />
        <Text style={[sFriendCard.footer, { color: onCardSecondary }]}>
          个人名片
        </Text>
      </Pressable>

      {message.time ? (
        <View style={sFriendCard.timeRow}>
          <Text
            style={{ ...Typography.tinyRegular, color: colors.textSecondary }}
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
      <View style={[sFriendCard.row, sFriendCard.rowOutgoing]}>
        {cardNode}
        <View style={sFriendCard.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sFriendCard.row}>
      {onAvatarPress ? (
        <Pressable style={sFriendCard.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sFriendCard.avatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};

interface CircleCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (card: CircleCardData) => void;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

// Circle share card — reuses the friend-card layout (sFriendCard). Tapping
// opens the circle detail, which owns live circle fetching and join checks.
export const CircleCardBubble: React.FC<CircleCardBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onPress,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const card = message.circleCard;

  if (!card) return null;

  const displayName = card.name;
  const displayAvatar = card.avatarUrl;

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const cardBg = outgoing ? colors.sentBubble : colors.receivedBubble;
  const onCardColor = outgoing ? colors.white : colors.text;
  const onCardSecondary = outgoing
    ? 'rgba(255,255,255,0.78)'
    : colors.textSecondary;
  const dividerColor = outgoing ? 'rgba(255,255,255,0.25)' : colors.divider;

  const cardNode = (
    <View style={[sFriendCard.body, outgoing ? sFriendCard.bodyOutgoing : null]}>
      <Pressable
        style={[sFriendCard.card, { backgroundColor: cardBg }]}
        onPress={onPress ? () => onPress(card) : undefined}
      >
        <View style={sFriendCard.topRow}>
          <CircleAvatar
            uri={displayAvatar}
            size={48}
            borderRadius={Radius.sm}
          />
          <View style={sFriendCard.textCol}>
            <Text
              style={[sFriendCard.nickname, { color: onCardColor }]}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            <Text
              style={[sFriendCard.persona, { color: onCardSecondary }]}
              numberOfLines={1}
            >
              {t('circle.card.type')}
            </Text>
          </View>
        </View>
        <View style={[sFriendCard.divider, { backgroundColor: dividerColor }]} />
        <Text style={[sFriendCard.footer, { color: onCardSecondary }]}>
          {t('circle.card.footer')}
        </Text>
      </Pressable>

      {message.time ? (
        <View style={sFriendCard.timeRow}>
          <Text
            style={{ ...Typography.tinyRegular, color: colors.textSecondary }}
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
      <View style={[sFriendCard.row, sFriendCard.rowOutgoing]}>
        {cardNode}
        <View style={sFriendCard.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sFriendCard.row}>
      {onAvatarPress ? (
        <Pressable style={sFriendCard.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sFriendCard.avatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};

interface TransferCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (data: TransferCardData) => void;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

const TRANSFER_GOLD = '#F59E0B';

const sTransfer = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: { justifyContent: 'flex-end' },
  body: { maxWidth: 260 },
  bodyOutgoing: { alignItems: 'flex-end' },
  card: {
    width: 260,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: TRANSFER_GOLD,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  unit: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.85)',
    marginLeft: 4,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  noteText: {
    ...Typography.small,
    color: '#FFFFFF',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  footer: {
    ...Typography.tinyRegular,
    color: 'rgba(255,255,255,0.85)',
  },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

export const TransferCardBubble: React.FC<TransferCardBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onPress,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const data = message.transferCard;
  if (!data) return null;

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const cardNode = (
    <View style={[sTransfer.body, outgoing ? sTransfer.bodyOutgoing : null]}>
      <Pressable
        style={sTransfer.card}
        onPress={onPress ? () => onPress(data) : undefined}
      >
        <View style={sTransfer.topRow}>
          <View style={sTransfer.iconWrap}>
            <Ionicons name="cash-outline" size={20} color="#FFFFFF" />
          </View>
          <View style={sTransfer.amountRow}>
            {/* toLocaleString 自动加千分位（1000000 → 1,000,000）；
                后端上限是 1_000_000（LIMITS.TRANSFER_MAX_AMOUNT），不会出现 NaN/Infinity */}
            <Text style={sTransfer.amount}>{data.amount.toLocaleString()}</Text>
            <Text style={sTransfer.unit}>积分</Text>
          </View>
        </View>
        {data.message ? (
          <Text style={sTransfer.noteText} numberOfLines={2}>
            {data.message}
          </Text>
        ) : null}
        <View style={sTransfer.divider} />
        <Text style={sTransfer.footer}>积分转账</Text>
      </Pressable>
      {message.time ? (
        <View style={sTransfer.timeRow}>
          <Text
            style={{ ...Typography.tinyRegular, color: colors.textSecondary }}
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
      <View style={[sTransfer.row, sTransfer.rowOutgoing]}>
        {cardNode}
        <View style={sTransfer.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sTransfer.row}>
      {onAvatarPress ? (
        <Pressable style={sTransfer.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sTransfer.avatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};
