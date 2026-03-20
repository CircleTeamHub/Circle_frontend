import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTheme, Radius } from '@/theme';

interface AvatarProps {
  size?: number;
  name?: string;
  uri?: string;
  bgColor?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  size = 40,
  name,
  uri,
  bgColor,
}) => {
  const { colors } = useTheme();
  const resolvedBgColor = bgColor ?? colors.primary;
  const borderRadius = size / 2;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        image: {
          backgroundColor: colors.surface,
        },
        fallback: {
          justifyContent: 'center',
          alignItems: 'center',
        },
        initial: {
          color: colors.white,
          fontWeight: '600',
        },
      }),
    [colors],
  );

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, { width: size, height: size, borderRadius }]}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius, backgroundColor: resolvedBgColor },
      ]}
    >
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>
        {name?.charAt(0) ?? '?'}
      </Text>
    </View>
  );
};
