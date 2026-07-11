import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export interface PostAction {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  onPress: () => void;
}

interface PlazaPostActionsSheetProps {
  visible: boolean;
  actions: readonly PostAction[];
  onClose: () => void;
}

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginVertical: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 54,
  },
  label: {
    ...Typography.body,
    flexShrink: 1,
  },
  cancel: {
    marginTop: Spacing.sm,
    marginHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  cancelText: {
    ...Typography.body,
    fontWeight: '600',
  },
});

export function PlazaPostActionsSheet({
  visible,
  actions,
  onClose,
}: PlazaPostActionsSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      label: { color: colors.text },
      destructive: { color: colors.error },
      cancel: { backgroundColor: colors.background },
      cancelText: { color: colors.text },
    }),
    [colors],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[
        s.sheet,
        d.sheet,
        { paddingBottom: insets.bottom || Spacing.lg },
      ]}
    >
      <View style={[s.handle, d.handle]} />
      {actions.map((action) => (
        <Pressable
          key={action.key}
          style={s.row}
          onPress={() => {
            // 先关闭弹层，再执行动作：避免在 Modal 关闭动画中叠加原生分享/弹窗。
            onClose();
            action.onPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Ionicons
            name={action.icon}
            size={20}
            color={action.destructive ? colors.error : colors.text}
          />
          <Text
            style={[s.label, action.destructive ? d.destructive : d.label]}
          >
            {action.label}
          </Text>
        </Pressable>
      ))}
      <Pressable
        style={[s.cancel, d.cancel]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
      >
        <Text style={[s.cancelText, d.cancelText]}>{t('common.cancel')}</Text>
      </Pressable>
    </BottomSheetModal>
  );
}
