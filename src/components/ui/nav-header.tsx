import { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { type Href, useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography } from '@/theme';

interface NavHeaderProps {
  title: string;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
  onBackPress?: () => void;
  fallbackHref?: Href;
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    paddingHorizontal: Spacing.lg,
  },
  spacer: {
    width: 24,
  },
});

export const NavHeader: React.FC<NavHeaderProps> = ({
  title,
  rightIcon,
  onRightPress,
  onBackPress,
  fallbackHref,
}) => {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();

  const handleBackPress = useCallback(() => {
    if (onBackPress) {
      onBackPress();
    } else if (navigation.canGoBack()) {
      router.back();
    } else if (fallbackHref) {
      router.replace(fallbackHref);
    }
  }, [fallbackHref, navigation, onBackPress, router]);

  const d = useMemo(
    () => ({
      title: {
        color: colors.text,
        ...Typography.h3,
      },
    }),
    [colors],
  );

  return (
    <View style={s.container}>
      <Pressable onPress={handleBackPress} hitSlop={8}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      <Text style={d.title}>{title}</Text>
      {rightIcon ? (
        <Pressable onPress={onRightPress} hitSlop={8}>
          <Ionicons name={rightIcon} size={22} color={colors.textSecondary} />
        </Pressable>
      ) : (
        <View style={s.spacer} />
      )}
    </View>
  );
};
