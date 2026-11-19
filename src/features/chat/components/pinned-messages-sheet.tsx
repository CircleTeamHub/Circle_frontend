import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { setChatPinnedMessage } from '@/chat-core/api';
import type { ChatPinnedMessageDto } from '@/chat-core/protocol';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface PinnedMessagesSheetProps {
  visible: boolean;
  conversationID: string;
  /** 最新置顶的在前,最多 5 条。 */
  pins: readonly ChatPinnedMessageDto[];
  /** 群主/管理员,私聊双方:每条右边多一个 × 取消置顶。 */
  canManage: boolean;
  onClose: () => void;
  onJump: (messageId: string) => void;
}

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    borderCurve: 'continuous',
    paddingTop: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  title: { ...Typography.body, fontWeight: '600', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.md, paddingRight: Spacing.xs },
  rowBody: { flex: 1, minHeight: 56, justifyContent: 'center', paddingVertical: Spacing.sm },
  rowPressed: { opacity: 0.55 },
  preview: { ...Typography.bodyRegular },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.md },
});

/** 点置顶横幅弹出的全部置顶:点一条关掉面板跳过去;有权限的人逐条取消。 */
export function PinnedMessagesSheet({
  visible, conversationID, pins, canManage, onClose, onJump,
}: PinnedMessagesSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={{ backgroundColor: colors.overlay }}
      sheetStyle={[s.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
    >
      <View style={[s.handle, { backgroundColor: colors.surfaceBorder }]} />
      <Text style={[s.title, { color: colors.text }]}>
        {t('chat.pin.listTitle', { count: pins.length, defaultValue: '置顶 · {{count}} 条' })}
      </Text>
      {pins.map((pin, index) => {
        const preview = pin.preview || t('chat.pin.fallbackPreview', { defaultValue: '[消息]' });
        return (
          <View key={pin.messageId}>
            {index > 0 ? <View style={[s.divider, { backgroundColor: colors.divider }]} /> : null}
            <View style={s.row}>
              <Pressable
                style={({ pressed }) => [s.rowBody, pressed && s.rowPressed]}
                onPress={() => {
                  onClose();
                  onJump(pin.messageId);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('chat.pin.bannerA11y', { preview, defaultValue: '置顶消息:{{preview}}' })}
              >
                <Text style={[s.preview, { color: colors.text }]} numberOfLines={2}>{preview}</Text>
              </Pressable>
              {canManage ? (
                <Pressable
                  style={s.close}
                  onPress={() => void unpin(pin.messageId)}
                  disabled={busyId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.pin.unpin', { defaultValue: '取消置顶' })}
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </BottomSheetModal>
  );
}
