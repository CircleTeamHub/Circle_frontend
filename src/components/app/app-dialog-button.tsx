import { Pressable, StyleSheet, Text } from 'react-native';
import { Radius, Spacing, useTheme } from '@/theme';
import type { DialogButtonRole } from './app-dialog-buttons';

interface AppDialogButtonProps {
  text: string;
  role: DialogButtonRole;
  /** 竖排菜单里的按钮整宽；并排时两个平分。 */
  grow?: boolean;
  onPress: () => void;
}

const s = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  grow: {
    flex: 1,
  },
  pressed: {
    opacity: 0.72,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});

/**
 * 弹窗按钮的六种角色 → 三种视觉：实心（primary / destructive）、玻璃上的半透明底
 * （secondary / option / optionDestructive）、无底（竖排里的 cancel）。
 */
export function AppDialogButton({ text, role, grow, onPress }: AppDialogButtonProps) {
  const { colors } = useTheme();

  const filledColor =
    role === 'primary'
      ? colors.primary
      : role === 'destructive'
        ? colors.dangerFill
        : null;
  const backgroundColor =
    filledColor ?? (role === 'cancel' && !grow ? 'transparent' : colors.glassButton);
  const labelColor = filledColor
    ? colors.white
    : role === 'optionDestructive'
      ? colors.danger
      : role === 'cancel' && !grow
        ? colors.textSecondary
        : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        grow && s.grow,
        { backgroundColor },
        pressed && s.pressed,
      ]}
    >
      <Text style={[s.label, { color: labelColor }]} numberOfLines={2}>
        {text}
      </Text>
    </Pressable>
  );
}
