import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, Spacing, Typography, Radius } from '@/theme';

interface DatePillProps {
  text: string;
}

const sDatePill = StyleSheet.create({
  datePillWrapper: {
    alignItems: 'center',
  },
  datePill: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.xs,
    paddingHorizontal: 14,
  },
});

export const DatePill: React.FC<DatePillProps> = ({ text }) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      datePill: {
        backgroundColor: colors.surface,
      },
      datePillText: {
        color: colors.textSecondary,
        ...Typography.small,
      },
    }),
    [colors],
  );

  return (
    <View style={sDatePill.datePillWrapper}>
      <View style={[sDatePill.datePill, d.datePill]}>
        <Text style={d.datePillText}>{text}</Text>
      </View>
    </View>
  );
};
