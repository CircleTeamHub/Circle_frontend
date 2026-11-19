import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { setChatPinnedMessage } from '@/chat-core/api';
import type { ChatPinnedMessageDto } from '@/chat-core/protocol';
import { useChatStore } from '@/chat-core/store';
import { canManageChatPins } from '@/features/chat/utils/chat-pins';
import { useChatPreferencesStore } from '@/features/chat/store/use-chat-preferences-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';

interface PinnedMessageBannerProps {
  conversationID: string;
  onJump: (messageId: string) => void;
}

const NO_PINS: ChatPinnedMessageDto[] = [];

const s = StyleSheet.create({
  container: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.md },
  tag: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  tagText: { ...Typography.tiny, fontWeight: '700' },
  preview: { ...Typography.bodyRegular, flex: 1 },
  title: { ...Typography.bodyRegular, flex: 1, fontWeight: '600' },
  count: { ...Typography.tiny },
  iconButton: {
    minWidth: 36,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: Spacing.xs,
  },
});

/**
 * 聊天顶部的置顶栏(所有人可见),样子跟群公告横幅一路。一个会话最多置顶 5 条:
 * - 只有一条:一行,点它跳到那条消息;有权限的人(群主/管理员,私聊双方)右边有 × 取消置顶。
 * - 多条:默认收起成一行,显示最新置顶的那条和「N 条 ⌄」;展开后列出全部,每条都能点、能 ×。
 *   展开 / 收起按会话记在本机(登出清掉)。
 */
export function PinnedMessageBanner({ conversationID, onJump }: PinnedMessageBannerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const conversation = useChatStore((state) => state.conversations.find((item) => item.id === conversationID));
  const expanded = useChatPreferencesStore(
    (state) => state.pinsExpandedByConversationID[conversationID] === true,
  );
  const setPinsExpanded = useChatPreferencesStore((state) => state.setPinsExpanded);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pins = conversation?.pinnedMessages ?? NO_PINS;
  if (!conversation || pins.length === 0) return null;
  const canManage = canManageChatPins(conversation);
  const multiple = pins.length > 1;

  const unpin = async (messageId: string) => {
    if (busyId) return;
    setBusyId(messageId);
    try {
      await setChatPinnedMessage(conversationID, messageId, false);
    } catch (error) {
      reportHandledFailure('chatDetail', 'unpinMessage', error);
      Alert.alert(
        t('chat.pin.failed', { defaultValue: '操作失败' }),
        getApiErrorMessage(error, t('common.retryLater', { defaultValue: '请稍后重试' })),
      );
    } finally {
      setBusyId(null);
    }
  };

  const tag = (
    <View style={[s.tag, { backgroundColor: withAlpha(colors.primary, 0.14) }]}>
      <Text style={[s.tagText, { color: colors.iconAccent }]}>
        {t('chat.pin.tag', { defaultValue: '置顶' })}
      </Text>
    </View>
  );
  const previewOf = (pin: ChatPinnedMessageDto) =>
    pin.preview || t('chat.pin.fallbackPreview', { defaultValue: '[消息]' });

  /** 一条置顶:点它跳过去;有权限的人右边多一个 ×。 */
  const pinRow = (pin: ChatPinnedMessageDto, options: { withTag: boolean; trailing?: ReactNode }) => (
    <Pressable
      style={s.row}
      onPress={() => onJump(pin.messageId)}
      accessibilityRole="button"
      accessibilityLabel={t('chat.pin.bannerA11y', { preview: previewOf(pin), defaultValue: '置顶消息:{{preview}}' })}
    >
      {options.withTag ? tag : null}
      <Text style={[s.preview, { color: colors.text }]} numberOfLines={1}>
        {previewOf(pin)}
      </Text>
      {options.trailing ??
        (canManage ? (
          <Pressable
            style={s.iconButton}
            onPress={() => void unpin(pin.messageId)}
            disabled={busyId !== null}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('chat.pin.unpin', { defaultValue: '取消置顶' })}
          >
            <Ionicons name="close" size={18} color={colors.text} />
          </Pressable>
        ) : null)}
    </Pressable>
  );

  const expandButton = (
    <Pressable
      style={s.iconButton}
      onPress={() => setPinsExpanded(conversationID, true)}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={t('chat.pin.expand', { defaultValue: '展开全部置顶' })}
    >
      <Text style={[s.count, { color: colors.textSecondary }]}>
        {t('chat.pin.count', { count: pins.length, defaultValue: '{{count}} 条' })}
      </Text>
      <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
    </Pressable>
  );

  return (
    <View style={s.container} testID="pinned-message-banner">
      <View style={[s.card, { backgroundColor: colors.surface }]}>
        {multiple && expanded ? (
          <>
            <Pressable
              style={s.row}
              onPress={() => setPinsExpanded(conversationID, false)}
              accessibilityRole="button"
              accessibilityLabel={t('chat.pin.collapse', { defaultValue: '收起置顶' })}
            >
              {tag}
              <Text style={[s.title, { color: colors.text }]} numberOfLines={1}>
                {t('chat.pin.listTitle', { count: pins.length, defaultValue: '置顶 · {{count}} 条' })}
              </Text>
              <View style={s.iconButton}>
                <Ionicons name="chevron-up" size={16} color={colors.textSecondary} />
              </View>
            </Pressable>
            {pins.map((pin) => (
              <View key={pin.messageId}>
                <View style={[s.divider, { backgroundColor: colors.divider }]} />
                {pinRow(pin, { withTag: false })}
              </View>
            ))}
          </>
        ) : (
          // 收起时只露最新置顶的那条;多条时右边是「N 条 ⌄」,取消置顶到展开后逐条操作。
          pinRow(pins[0], { withTag: true, ...(multiple ? { trailing: expandButton } : {}) })
        )}
      </View>
    </View>
  );
}
