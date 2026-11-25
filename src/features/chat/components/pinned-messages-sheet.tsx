import { ChevronRight, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { setChatPinnedMessage } from '@/chat-core/api';
import type { ChatPinnedMessageDto } from '@/chat-core/protocol';
import { BottomSheetModal, BottomSheetScrollView } from '@/components/ui/bottom-sheet-modal';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface PinnedMessagesSheetProps {
  visible: boolean;
  conversationID: string;
  /** 最新置顶的在前,最多 5 条。 */
  pins: readonly ChatPinnedMessageDto[];
  /** 群主、管理员和私聊双方可以取消置顶。 */
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
    maxHeight: '80%',
  },
  content: { flexShrink: 1 },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  heading: { flex: 1, gap: Spacing.xs },
  title: Typography.h2,
  count: Typography.caption,
  close: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingHorizontal: Spacing.md },
  list: { borderRadius: Radius.lg, borderCurve: 'continuous' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 56,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 12,
  },
  preview: { ...Typography.bodyRegular, flex: 1 },
  unpin: {
    minWidth: 44,
    minHeight: 44,
    maxWidth: '42%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  unpinText: { ...Typography.caption, textAlign: 'center' },
  pressed: { opacity: 0.65 },
});

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
      sheetStyle={[s.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
    >
      <View style={s.content} accessibilityViewIsModal>
        <View style={[s.handle, { backgroundColor: colors.surfaceBorder }]} />
        <View style={s.header}>
          <View style={s.heading}>
            <Text style={[s.title, { color: colors.text }]} accessibilityRole="header">
              {t('chat.pin.listHeading')}
            </Text>
            <Text style={[s.count, { color: colors.textSecondary }]}>
              {t('chat.pin.listCount', { count: pins.length })}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [s.close, { backgroundColor: colors.surfaceMuted }, pressed && s.pressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <X size={19} color={colors.textSecondary} />
          </Pressable>
        </View>
        <BottomSheetScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[s.list, { backgroundColor: colors.surfaceMuted }]}>
            {pins.map((pin, index) => {
              const preview = pin.preview || t('chat.pin.fallbackPreview');
              return (
                <View
                  key={pin.messageId}
                  style={[s.row, index > 0 && s.rowDivider, { borderColor: colors.divider }]}
                >
                  <Pressable
                    style={({ pressed }) => [s.rowBody, pressed && s.pressed]}
                    onPress={() => {
                      onClose();
                      onJump(pin.messageId);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('chat.pin.jumpA11y', { preview })}
                  >
                    <Text style={[s.preview, { color: colors.text }]} numberOfLines={2}>{preview}</Text>
                    <ChevronRight size={16} color={colors.textSecondary} />
                  </Pressable>
                  {canManage ? (
                    <Pressable
                      style={({ pressed }) => [s.unpin, (pressed || busyId !== null) && s.pressed]}
                      onPress={() => void unpin(pin.messageId)}
                      disabled={busyId !== null}
                      accessibilityRole="button"
                      accessibilityLabel={t('chat.pin.unpinA11y', { preview })}
                      accessibilityState={{ busy: busyId === pin.messageId }}
                    >
                      <Text style={[s.unpinText, { color: colors.link }]}>{t('chat.pin.unpin')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </BottomSheetScrollView>
      </View>
    </BottomSheetModal>
  );
}
