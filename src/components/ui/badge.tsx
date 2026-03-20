import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';

interface BadgeProps {
  count: number;
}

export const Badge: React.FC<BadgeProps> = ({ count }) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        badge: {
          backgroundColor: colors.primary,
          borderRadius: 10,
          minWidth: 20,
          height: 20,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 6,
        },
        text: {
          color: colors.white,
          fontSize: 11,
          fontWeight: '600',
        },
      }),
    [colors],
  );

  if (count <= 0) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{count}</Text>
    </View>
  );
};
