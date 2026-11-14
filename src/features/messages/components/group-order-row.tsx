import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderHandlers,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export const GROUP_ORDER_ROW_HEIGHT = 64;
/** 行高 + 行间距；拖动换算落点用。 */
export const GROUP_ORDER_ROW_STRIDE = GROUP_ORDER_ROW_HEIGHT + Spacing.sm;

interface GroupOrderRowProps {
  id: string;
  label: string;
  subtitle: string;
  /** 自定义分组暂不显示在消息页时淡一点。 */
  muted: boolean;
  dragging: boolean;
  /** 别的行正在被拖。 */
  dimmed: boolean;
  dragY: Animated.Value;
  dragHandlers: GestureResponderHandlers;
  position: number;
  total: number;
  onMove: (id: string, offset: number) => void;
  /** 只有自定义分组可以点进去编辑。 */
  onPress?: (id: string) => void;
}

const s = StyleSheet.create({
  row: {
    height: GROUP_ORDER_ROW_HEIGHT,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  handle: {
    width: 48,
    height: GROUP_ORDER_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingRight: Spacing.md,
  },
  text: { flex: 1, gap: 2 },
  label: { ...Typography.body, fontWeight: '600' },
  subtitle: { ...Typography.small },
  muted: { opacity: 0.55 },
  dimmed: { opacity: 0.78 },
});

export const GroupOrderRow = memo(function GroupOrderRow({
  id,
  label,
  subtitle,
  muted,
  dragging,
  dimmed,
  dragY,
  dragHandlers,
  position,
  total,
  onMove,
  onPress,
}: GroupOrderRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      row: { backgroundColor: colors.surface },
      lifted: {
        transform: [{ translateY: dragY }],
        zIndex: 2,
        shadowColor: colors.black,
        shadowOpacity: 0.12,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      },
      label: { color: colors.text },
      subtitle: { color: colors.textSecondary },
    }),
    [colors, dragY],
  );
  const accessibilityActions = useMemo(
    () => [
      { name: 'decrement', label: t('messages.groups.moveUp', { defaultValue: '上移' }) },
      { name: 'increment', label: t('messages.groups.moveDown', { defaultValue: '下移' }) },
    ],
    [t],
  );
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'decrement') onMove(id, -1);
    else if (event.nativeEvent.actionName === 'increment') onMove(id, 1);
  };

  const body = (
    <>
      <View style={[s.text, muted ? s.muted : null]}>
        <Text style={[s.label, d.label]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[s.subtitle, d.subtitle]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {onPress ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      ) : null}
    </>
  );

  // 拖柄和行身是兄弟节点：嵌在可点的行里时，读屏会把它并进整行，上移/下移就点不到了。
  return (
    <Animated.View style={[s.row, d.row, dragging ? d.lifted : dimmed ? s.dimmed : null]}>
      <View
        style={s.handle}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('messages.groups.reorderA11y', {
          defaultValue: '调整「{{name}}」的位置',
          name: label,
        })}
        accessibilityValue={{ text: `${position} / ${total}` }}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={handleAccessibilityAction}
        {...dragHandlers}
      >
        <Ionicons name="reorder-three-outline" size={24} color={colors.textSecondary} />
      </View>
      {onPress ? (
        <Pressable
          style={s.body}
          onPress={() => onPress(id)}
          accessibilityRole="button"
          accessibilityHint={t('messages.groups.editHint', { defaultValue: '编辑名称和会话' })}
        >
          {body}
        </Pressable>
      ) : (
        <View style={s.body}>{body}</View>
      )}
    </Animated.View>
  );
});
