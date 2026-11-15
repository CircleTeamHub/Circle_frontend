import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { ChatMessage, NoteCardData } from '@/types';
import { NoteCardBody, type NoteCardSection } from './note-card-body';

/** 引用块最宽 280(与气泡同宽),左右各留 8 给灰底边。 */
const QUOTE_BLOCK_MAX_WIDTH = 280;
const QUOTED_NOTE_CARD_WIDTH = QUOTE_BLOCK_MAX_WIDTH - Spacing.sm * 2;

interface QuotedNoteCardProps {
  /** 被引用的那条笔记卡片消息:点卡片时以它为来源坐标打开详情。 */
  source: ChatMessage;
  note: NoteCardData;
  senderName?: string;
  align: 'start' | 'end';
  /** 点灰底(发送者那行)定位到原消息。 */
  onPress?: () => void;
  onOpenNote?: (message: ChatMessage, note: NoteCardData, section?: NoteCardSection | '') => void;
}

/**
 * 引用笔记时的引用块:灰底里一行「发送者:」,下面是与聊天里一模一样的整张笔记卡片。
 * 卡片一律按「收到的」配色,自己发的笔记也不会在引用里变成一块主题紫。
 */
export const QuotedNoteCard: React.FC<QuotedNoteCardProps> = ({
  source,
  note,
  senderName,
  align,
  onPress,
  onOpenNote,
}) => {
  const { colors } = useTheme();
  const themed = useMemo(
    () => ({
      box: { backgroundColor: colors.quoteBlock },
      text: { color: colors.quoteBlockText },
    }),
    [colors.quoteBlock, colors.quoteBlockText],
  );
  return (
    <Pressable
      testID="quote-block"
      style={[s.box, align === 'end' ? s.alignEnd : s.alignStart, themed.box]}
      onPress={onPress}
      disabled={!onPress}
    >
      {senderName ? (
        <Text style={[s.name, themed.text]} numberOfLines={1}>
          {`${senderName}:`}
        </Text>
      ) : null}
      <NoteCardBody
        note={note}
        outgoing={false}
        width={QUOTED_NOTE_CARD_WIDTH}
        onPress={onOpenNote ? (pressed) => onOpenNote(source, pressed) : undefined}
        onSectionPress={
          onOpenNote ? (pressed, section) => onOpenNote(source, pressed, section) : undefined
        }
      />
    </Pressable>
  );
};

const s = StyleSheet.create({
  box: {
    gap: Spacing.xs,
    borderRadius: Radius.xs,
    padding: Spacing.sm,
    marginTop: Spacing.xs,
    maxWidth: QUOTE_BLOCK_MAX_WIDTH,
  },
  alignStart: { alignSelf: 'flex-start' },
  alignEnd: { alignSelf: 'flex-end' },
  name: {
    ...Typography.bodyRegular,
    lineHeight: 20,
    paddingHorizontal: Spacing.xs,
  },
});
