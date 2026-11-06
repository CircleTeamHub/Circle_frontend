import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { setChatPinnedMessage } from '@/chat-core/api';
import { useChatStore } from '@/chat-core/store';
import { canManageChatPins } from '@/features/chat/utils/chat-pins';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';

interface PinnedMessageBannerProps {
  conversationID: string;
  onJump: (messageId: string) => void;
}

const s = StyleSheet.create({
  container: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  card: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    borderRadius: Radius.lg,
  },
  tag: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  tagText: { ...Typography.tiny, fontWeight: '700' },
  preview: { ...Typography.bodyRegular, flex: 1 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});

/**
 * 聊天顶部的置顶消息横幅(所有人可见),样子跟群公告横幅一路:点它跳到那条消息;
 * 有权限的人(群主/管理员,私聊双方)右边多一个 × 取消置顶。
 */
export function PinnedMessageBanner({ conversationID, onJump }: PinnedMessageBannerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const conversation = useChatStore((state) => state.conversations.find((item) => item.id === conversationID));
  const [busy, setBusy] = useState(false);
  const pinned = conversation?.pinnedMessage;
  if (!conversation || !pinned) return null;
  const canManage = canManageChatPins(conversation);

  const unpin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setChatPinnedMessage(conversationID, null);
    } catch (error) {
      reportHandledFailure('chatDetail', 'unpinMessage', error);
      Alert.alert(
        t('chat.pin.failed', { defaultValue: '操作失败' }),
        getApiErrorMessage(error, t('common.retryLater', { defaultValue: '请稍后重试' })),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.container} testID="pinned-message-banner">
      <Pressable
        style={[s.card, { backgroundColor: colors.surface }]}
        onPress={() => onJump(pinned.messageId)}
        accessibilityRole="button"
        accessibilityLabel={t('chat.pin.bannerA11y', { preview: pinned.preview, defaultValue: '置顶消息:{{preview}}' })}
      >
        <View style={[s.tag, { backgroundColor: withAlpha(colors.primary, 0.14) }]}>
          <Text style={[s.tagText, { color: colors.iconAccent }]}>
            {t('chat.pin.tag', { defaultValue: '置顶' })}
          </Text>
        </View>
        <Text style={[s.preview, { color: colors.text }]} numberOfLines={1}>
          {pinned.preview || t('chat.pin.fallbackPreview', { defaultValue: '[消息]' })}
        </Text>
        {canManage ? (
          <Pressable
            style={s.close}
            onPress={() => void unpin()}
            disabled={busy}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('chat.pin.unpin', { defaultValue: '取消置顶' })}
          >
            <Ionicons name="close" size={18} color={colors.text} />
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
}
