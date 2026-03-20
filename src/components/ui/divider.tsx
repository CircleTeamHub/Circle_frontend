import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';

export const Divider: React.FC = () => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        line: {
          height: 1,
          backgroundColor: colors.divider,
        },
      }),
    [colors],
  );

  return <View style={styles.line} />;
};
