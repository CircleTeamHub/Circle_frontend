import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, Typography, useTheme } from '@/theme';

interface ProfileActionRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
}

export const ProfileActionRow: React.FC<ProfileActionRowProps> = ({
  label,
  value,
  onPress,
}) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: Spacing.md,
          paddingVertical: Spacing.md,
        },
        label: {
          color: colors.text,
          ...Typography.body,
        },
        right: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          flexShrink: 1,
        },
        value: {
          color: colors.textSecondary,
          ...Typography.caption,
          flexShrink: 1,
          textAlign: 'right',
        },
      }),
    [colors],
  );

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.right}>
        {value ? <Text style={styles.value}>{value}</Text> : null}
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textSecondary}
        />
      </View>
    </Pressable>
  );
};
