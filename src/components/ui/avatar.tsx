import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTheme, Radius } from '@/theme';

interface AvatarProps {
  size?: number;
  name?: string;
  uri?: string;
  bgColor?: string;
}

const s = StyleSheet.create({
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export const Avatar: React.FC<AvatarProps> = ({
  size = 40,
  name,
  uri,
  bgColor,
}) => {
  const { colors } = useTheme();
  const resolvedBgColor = bgColor ?? colors.primary;
  const borderRadius = size / 2;

  const d = useMemo(
    () => ({
      image: {
        backgroundColor: colors.surface,
      },
      initial: {
        color: colors.white,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[d.image, { width: size, height: size, borderRadius }]}
      />
    );
  }

  return (
    <View
      style={[
        s.fallback,
        { width: size, height: size, borderRadius, backgroundColor: resolvedBgColor },
      ]}
    >
      <Text style={[d.initial, { fontSize: size * 0.4 }]}>
        {name?.charAt(0) ?? '?'}
      </Text>
    </View>
  );
};
