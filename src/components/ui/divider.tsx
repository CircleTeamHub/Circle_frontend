import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';

const s = StyleSheet.create({
  line: {
    height: 1,
  },
});

export const Divider: React.FC = () => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      line: {
        backgroundColor: colors.divider,
      },
    }),
    [colors],
  );

  return <View style={[s.line, d.line]} />;
};
