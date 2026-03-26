import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Radius, Typography } from '@/theme';

interface SearchBarProps {
  placeholder?: string;
  onPress?: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = '搜索...',
  onPress,
}) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: Radius.xxl,
          height: 40,
          paddingHorizontal: Spacing.md,
          gap: Spacing.sm,
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
        },
        placeholder: {
          color: colors.textSecondary,
          ...Typography.bodyRegular,
        },
      }),
    [colors],
  );

  const content = (
    <View style={styles.container}>
      <Ionicons name="search" size={18} color={colors.textSecondary} />
      <Text style={styles.placeholder}>{placeholder}</Text>
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }

  return content;
};
