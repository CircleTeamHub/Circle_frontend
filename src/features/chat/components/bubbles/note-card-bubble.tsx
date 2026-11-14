import { View, Text, StyleSheet, Pressable, type GestureResponderEvent } from 'react-native';
import { useTheme, Spacing, Typography } from '@/theme';
import type { ChatMessage, NoteCardData } from '@/types';
import { NoteCardBody, type NoteCardSection } from './note-card-body';
import {
  BubbleStatusText,
  MessageAvatar,
} from './shared';

interface NoteCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (note: NoteCardData) => void;
  onSectionPress?: (note: NoteCardData, section: NoteCardSection) => void;
  onAvatarPress?: () => void;
  onAvatarLongPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
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
  bodyOutgoing: {
    alignItems: 'flex-end',
  },
  avatarSlot: { paddingBottom: 2 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});

/** 笔记卡片消息:头像 + 卡片主体(NoteCardBody)+ 时间/送达状态。 */
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
  onAvatarLongPress,
  onLongPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const note = message.noteCard;

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

  if (!note) return null;

  // 宽度由卡片自己定(随屏幕变宽,见 noteCardWidth),这里不再卡 260。
  const cardNode = (
    <View style={outgoing ? sNote.bodyOutgoing : null}>
      <NoteCardBody
        note={note}
        outgoing={outgoing}
        onPress={onPress}
        onSectionPress={onSectionPress}
        onLongPress={onLongPress}
      />
      {message.time ? (
        <View style={sNote.timeRow}>
          <Text
            style={{ ...Typography.tinyRegular, color: colors.text }}
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
      {onAvatarPress || onAvatarLongPress ? (
        <Pressable style={sNote.avatarSlot} onPress={onAvatarPress} onLongPress={onAvatarLongPress} delayLongPress={350}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sNote.avatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};
