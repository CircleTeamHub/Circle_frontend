import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Radius, Typography } from '@/theme';

interface SearchBarProps {
  placeholder?: string;
  onPress?: () => void;
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.xxl,
    height: 40,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
  },
});

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = '搜索...',
  onPress,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.surface,
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
    <View style={[s.container, d.container]}>
      <Ionicons name="search" size={18} color={colors.textSecondary} />
      <Text style={d.placeholder}>{placeholder}</Text>
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }

  return content;
};
