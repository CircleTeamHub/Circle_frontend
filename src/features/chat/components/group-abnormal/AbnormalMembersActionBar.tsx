import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface Props {
  selectedCount: number;
  /** 当前筛选下可选的人数(上限已封顶)。 */
  selectableCount: number;
  limit: number;
  pending: boolean;
  bottomInset: number;
  onToggleAll: () => void;
  onRemove: () => void;
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm + Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  left: { flex: 1, gap: Spacing.xs / 2 },
  selectAll: { ...Typography.body },
  limit: { ...Typography.small },
  remove: {
    minWidth: 112,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { ...Typography.body },
});

/** 异常成员页底栏:全选/取消全选 + 移出(n)。 */
export const AbnormalMembersActionBar: React.FC<Props> = ({
  selectedCount,
  selectableCount,
  limit,
  pending,
  bottomInset,
  onToggleAll,
  onRemove,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const allSelected = selectableCount > 0 && selectedCount >= selectableCount;
  const canRemove = selectedCount > 0 && !pending;

  const d = useMemo(
    () => ({
      bar: {
        backgroundColor: colors.surface,
        borderTopColor: colors.divider,
        paddingBottom: bottomInset + Spacing.sm,
      },
      selectAll: { color: selectableCount > 0 ? colors.primary : colors.textSecondary },
      limit: { color: colors.textSecondary },
      remove: { backgroundColor: canRemove ? colors.dangerFill : colors.surfaceMuted },
      removeText: { color: canRemove ? colors.white : colors.textSecondary },
    }),
    [bottomInset, canRemove, colors, selectableCount],
  );

  return (
    <View style={[s.bar, d.bar]}>
      <View style={s.left}>
        <Pressable
          onPress={onToggleAll}
          disabled={selectableCount === 0 || pending}
          accessibilityRole="button"
          testID="abnormal-select-all"
        >
          <Text style={[s.selectAll, d.selectAll]}>
            {allSelected
              ? t('chat.groupManagement.abnormal.clearAll')
              : t('chat.groupManagement.abnormal.selectAll')}
          </Text>
        </Pressable>
        <Text style={[s.limit, d.limit]}>
          {t('chat.groupManagement.abnormal.batchLimit', { n: limit })}
        </Text>
      </View>
      <Pressable
        style={[s.remove, d.remove]}
        onPress={onRemove}
        disabled={!canRemove}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canRemove }}
        testID="abnormal-remove-selected"
      >
        {pending ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <Text style={[s.removeText, d.removeText]}>
            {t('chat.groupManagement.abnormal.removeSelected', { n: selectedCount })}
          </Text>
        )}
      </Pressable>
    </View>
  );
};
