import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Typography } from '@/theme';

interface NoteRatingCountsProps {
  goodCount?: number;
  badCount?: number;
  color: string;
  testID?: string;
}

/**
 * The "👍 N 👎 M" area (this month's counters of the source note) on list and
 * chat note cards. Zeros are shown too, so every card has the same layout.
 */
export function NoteRatingCounts({ goodCount = 0, badCount = 0, color, testID }: NoteRatingCountsProps) {
  const { t } = useTranslation();
  return (
    <View
      style={s.row}
      testID={testID}
      accessible
      accessibilityLabel={t('notes.rating.countsA11y', {
        defaultValue: '本月好评 {{good}}，差评 {{bad}}',
        good: goodCount,
        bad: badCount,
      })}
    >
      <Text style={[s.count, { color }]}>👍 {goodCount}</Text>
      <Text style={[s.count, { color }]}>👎 {badCount}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  count: { ...Typography.small, fontVariant: ['tabular-nums'] },
});
