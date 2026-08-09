import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme, Spacing, Typography } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { getAvatarFrameSource } from '@/features/profile/membership-frames';
import { useAuthStore } from '@/stores/authStore';
import type { ChatMessage } from '@/types';
import { AVATAR_SIZE, BubbleStatusText } from './shared';

interface SentBubbleProps {
  message: ChatMessage;
  selfName?: string;
  selfAvatarUri?: string;
  hideStatus?: boolean;
  /** 真引用(G-09):点击引用块定位到原消息;原消息不可达时不传。 */
  onQuotePress?: () => void;
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
  quoteBox: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
    maxWidth: 240,
  },
});

export const SentBubble: React.FC<SentBubbleProps> = ({
  message,
  selfName,
  selfAvatarUri,
  hideStatus,
  onQuotePress,
}) => {
  const { colors } = useTheme();
  const selfAvatarFrame = useAuthStore(
    (state) => state.user?.avatarFrameAppearance,
  );

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
      quoteBox: {
        backgroundColor: 'rgba(255,255,255,0.18)',
      },
      quoteText: {
        color: 'rgba(255,255,255,0.78)',
        ...Typography.tinyRegular,
      },
    }),
    [colors],
  );

  return (
    <View style={sSent.sentRow}>
      <View style={sSent.sentContent}>
        <View style={[sSent.sentBubble, d.sentBubble]}>
          {message.quotedText ? (
            onQuotePress ? (
              <Pressable
                style={[sSent.quoteBox, d.quoteBox]}
                onPress={onQuotePress}
              >
                <Text style={d.quoteText} numberOfLines={2}>{message.quotedText}</Text>
              </Pressable>
            ) : (
              <View style={[sSent.quoteBox, d.quoteBox]}>
                <Text style={d.quoteText} numberOfLines={2}>{message.quotedText}</Text>
              </View>
            )
          ) : null}
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
          name={selfName}
          uri={selfAvatarUri}
          frameSource={getAvatarFrameSource(selfAvatarFrame) ?? undefined}
          compactFrame
        />
      </View>
    </View>
  );
};
