import { Fragment, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';

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
  /** 面板顶部的一行上下文(帖子正文开头),让人知道是在操作哪一条。 */
  context?: string;
  onClose: () => void;
}

const ICON_CHIP_SIZE = 32;

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.xs,
  },
  context: {
    ...Typography.small,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  // 一组操作一张圆角卡片:普通操作一组,删除/举报单独一组。
  group: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    minHeight: 56,
  },
  iconChip: {
    width: ICON_CHIP_SIZE,
    height: ICON_CHIP_SIZE,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...Typography.body,
    fontWeight: '500',
    flexShrink: 1,
  },
  // 分割线从文字起始处开始,不穿过图标。
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.md + ICON_CHIP_SIZE + Spacing.md,
  },
  cancel: {
    marginTop: Spacing.xs,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  cancelText: {
    ...Typography.body,
    fontWeight: '600',
  },
});

export function PlazaPostActionsSheet({
  visible,
  actions,
  context,
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
      context: { color: colors.textSecondary },
      group: { backgroundColor: withAlpha(colors.text, 0.06) },
      pressed: { backgroundColor: withAlpha(colors.text, 0.08) },
      divider: { backgroundColor: colors.divider },
      label: { color: colors.text },
      destructiveLabel: { color: colors.error },
      chip: { backgroundColor: withAlpha(colors.text, 0.08) },
      destructiveChip: { backgroundColor: withAlpha(colors.error, 0.14) },
      cancel: { backgroundColor: withAlpha(colors.text, 0.06) },
      cancelText: { color: colors.text },
    }),
    [colors],
  );

  const main = actions.filter((action) => !action.destructive);
  const danger = actions.filter((action) => action.destructive);

  const renderGroup = (group: readonly PostAction[], testID: string) => (
    <View style={[s.group, d.group]} testID={testID}>
      {group.map((action, index) => (
        <Fragment key={action.key}>
          {index > 0 ? <View style={[s.divider, d.divider]} /> : null}
          <Pressable
            style={({ pressed }) => [s.row, pressed && d.pressed]}
            onPress={() => {
              // 先关闭弹层，再执行动作：避免在 Modal 关闭动画中叠加原生分享/弹窗。
              onClose();
              action.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <View style={[s.iconChip, action.destructive ? d.destructiveChip : d.chip]}>
              <Ionicons
                name={action.icon}
                size={18}
                color={action.destructive ? colors.error : colors.text}
              />
            </View>
            <Text style={[s.label, action.destructive ? d.destructiveLabel : d.label]}>
              {action.label}
            </Text>
          </Pressable>
        </Fragment>
      ))}
    </View>
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
      {context ? (
        <Text style={[s.context, d.context]} numberOfLines={1}>
          {context}
        </Text>
      ) : null}
      {main.length > 0 ? renderGroup(main, 'plaza-actions-main') : null}
      {danger.length > 0 ? renderGroup(danger, 'plaza-actions-danger') : null}
      <Pressable
        style={({ pressed }) => [s.cancel, d.cancel, pressed && d.pressed]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel', { defaultValue: '取消' })}
      >
        <Text style={[s.cancelText, d.cancelText]}>
          {t('common.cancel', { defaultValue: '取消' })}
        </Text>
      </Pressable>
    </BottomSheetModal>
  );
}
