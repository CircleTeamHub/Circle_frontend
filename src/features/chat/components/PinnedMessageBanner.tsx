import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChevronRight, List, Pin } from 'lucide-react-native';
import type { ChatPinnedMessageDto } from '@/chat-core/protocol';
import { useChatStore } from '@/chat-core/store';
import { PinnedMessagesSheet } from '@/features/chat/components/pinned-messages-sheet';
import { canManageChatPins } from '@/features/chat/utils/chat-pins';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface PinnedMessageBannerProps {
  conversationID: string;
  onJump: (messageId: string) => void;
}

const NO_PINS: ChatPinnedMessageDto[] = [];

export function PinnedMessageBanner({ conversationID, onJump }: PinnedMessageBannerProps) {
  // 分开取:整个会话行每来一条消息都会换,横幅只关心置顶和权限。
  const pins = useChatStore(
    (state) => state.conversations.find((item) => item.id === conversationID)?.pinnedMessages ?? NO_PINS,
  );
  const canManage = useChatStore((state) => {
    const conversation = state.conversations.find((item) => item.id === conversationID);
    return conversation ? canManageChatPins(conversation) : false;
  });
  // 置顶清空时整块卸掉,列表开着的状态跟着丢:之后再有人置顶,列表不会自己弹出来。
  if (pins.length === 0) return null;
  return (
    <PinnedBannerWithList
      key={conversationID}
      conversationID={conversationID}
      pins={pins}
      canManage={canManage}
      onJump={onJump}
    />
  );
}

function PinnedBannerWithList({ conversationID, pins, canManage, onJump }: PinnedMessageBannerProps & {
  pins: readonly ChatPinnedMessageDto[];
  canManage: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [listOpen, setListOpen] = useState(false);
  const latestPin = pins[0];
  const preview = latestPin.preview?.replace(/\s+/g, ' ').trim() || t('chat.pin.fallbackPreview');
  const multiple = pins.length > 1;
  const canOpenList = multiple || canManage;

  return (
    <View style={styles.container} testID="pinned-message-banner">
      <View style={[styles.bar, { backgroundColor: colors.pinnedSurface, borderColor: colors.surfaceBorder }]}>
        <Pressable
          style={({ pressed }) => [styles.jump, pressed && styles.pressed]}
          onPress={() => onJump(latestPin.messageId)}
          accessibilityRole="button"
          accessibilityLabel={t('chat.pin.jumpA11y', { preview })}
        >
          <Pin size={15} color={colors.link} />
          <Text style={[styles.tag, { color: colors.text }]} numberOfLines={1}>
            {t('chat.pin.tag')}
          </Text>
          <Text style={[styles.preview, { color: colors.pinnedTextSecondary }]} numberOfLines={1}>
            {preview}
          </Text>
          {canOpenList ? null : <ChevronRight size={16} color={colors.pinnedTextSecondary} />}
        </Pressable>
        {canOpenList ? (
          <Pressable
            style={({ pressed }) => [styles.list, { borderColor: colors.surfaceBorder }, pressed && styles.pressed]}
            onPress={() => setListOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('chat.pin.openList', { count: pins.length })}
            accessibilityState={{ expanded: listOpen }}
          >
            <List size={17} color={colors.link} />
            {multiple ? <Text style={[styles.count, { color: colors.link }]}>{pins.length}</Text> : null}
          </Pressable>
        ) : null}
      </View>
      <PinnedMessagesSheet
        visible={listOpen}
        conversationID={conversationID}
        pins={pins}
        canManage={canManage}
        onClose={() => setListOpen(false)}
        onJump={onJump}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  bar: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  jump: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: Spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: Spacing.sm,
  },
  tag: { ...Typography.caption, fontWeight: '700', maxWidth: '35%' },
  preview: { ...Typography.bodyRegular, flex: 1 },
  list: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderStartWidth: StyleSheet.hairlineWidth,
  },
  count: { ...Typography.caption, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.65 },
});
