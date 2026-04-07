import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, Typography, useTheme } from '@/theme';

interface ProfileActionRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 1,
  },
});

export const ProfileActionRow: React.FC<ProfileActionRowProps> = ({
  label,
  value,
  onPress,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      label: {
        color: colors.text,
        ...Typography.body,
      },
      value: {
        color: colors.textSecondary,
        ...Typography.caption,
        flexShrink: 1,
        textAlign: 'right' as const,
      },
    }),
    [colors],
  );

  return (
    <Pressable style={s.row} onPress={onPress}>
      <Text style={d.label}>{label}</Text>
      <View style={s.right}>
        {value ? <Text style={d.value}>{value}</Text> : null}
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textSecondary}
        />
      </View>
    </Pressable>
  );
};
