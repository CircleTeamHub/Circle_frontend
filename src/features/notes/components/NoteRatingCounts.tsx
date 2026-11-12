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
 * Small "👍 N 👎 M" counters (this month) for list and chat note cards. Renders
 * nothing until the note has a rating this month, so unrated notes stay quiet.
 */
export function NoteRatingCounts({ goodCount = 0, badCount = 0, color, testID }: NoteRatingCountsProps) {
  const { t } = useTranslation();
  if (goodCount <= 0 && badCount <= 0) return null;
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
