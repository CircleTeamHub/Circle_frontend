import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage, NoteCardData } from '@/types';
import {
  AVATAR_SIZE,
  BubbleStatusText,
  CHAT_CARD_STANDARD_WIDTH,
  CHAT_CARD_PADDING_VERTICAL,
  CHAT_CARD_GAP,
} from './shared';

interface NoteCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (note: NoteCardData) => void;
  onSectionPress?: (note: NoteCardData, section: 'text' | 'media' | 'showcase' | 'location') => void;
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
    maxWidth: CHAT_CARD_STANDARD_WIDTH,
  },
  bodyOutgoing: {
    alignItems: 'flex-end',
  },
  card: {
    width: CHAT_CARD_STANDARD_WIDTH,
    borderRadius: Radius.md,
    overflow: 'hidden',
    paddingVertical: CHAT_CARD_PADDING_VERTICAL,
    paddingHorizontal: Spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    gap: CHAT_CARD_GAP,
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
  preview: { ...Typography.small, lineHeight: 17 },
  meta: {
    ...Typography.tinyRegular,
    marginTop: 6,
  },
  chips: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  chipText: { ...Typography.tiny, fontWeight: '600' },
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
  onSectionPress,
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
    note: note.hasText ?? Boolean(note.contentPreview && note.contentPreview.trim()),
    video: note.videoCount > 0,
    display: (note.showcaseCount ?? note.imageCount) > 0,
    location: note.hasLocation ?? false,
  };

  const chips: { id: keyof typeof flags; label: string; section: 'text' | 'media' | 'showcase' | 'location' }[] = [
    { id: 'note', label: '笔记', section: 'text' },
    { id: 'video', label: '视频', section: 'media' },
    { id: 'display', label: '展示', section: 'showcase' },
    { id: 'location', label: '位置', section: 'location' },
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
                numberOfLines={2}
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
              <Pressable
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
                disabled={!active}
                onPress={
                  active && onSectionPress
                    ? () => onSectionPress(note, chip.section)
                    : undefined
                }
              >
                <Text
                  style={[
                    sNote.chipText,
                    { color: active ? colors.white : onCardSecondary },
                  ]}
                >
                  {chip.label}
                </Text>
              </Pressable>
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
