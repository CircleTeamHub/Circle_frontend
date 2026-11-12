import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Typography } from '@/theme';

/** 好评 is a firework, 差评 a rain cloud: the same pair in every rating entry point. */
export const NOTE_RATING_GOOD_ICON = 'firework' as const;
export const NOTE_RATING_BAD_ICON = 'weather-pouring' as const;

interface NoteRatingCountsProps {
  goodCount?: number;
  badCount?: number;
  color: string;
  testID?: string;
}

/**
 * The 好评 / 差评 area (this month's counters of the source note) on list and
 * chat note cards: icon, then the number. Zeros are shown too, so every card
 * has the same layout.
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
      <View style={s.item}>
        <MaterialCommunityIcons name={NOTE_RATING_GOOD_ICON} size={ICON_SIZE} color={color} />
        <Text style={[s.count, { color }]} testID={testID ? `${testID}-good` : undefined}>
          {goodCount}
        </Text>
      </View>
      <View style={s.item}>
        <MaterialCommunityIcons name={NOTE_RATING_BAD_ICON} size={ICON_SIZE} color={color} />
        <Text style={[s.count, { color }]} testID={testID ? `${testID}-bad` : undefined}>
          {badCount}
        </Text>
      </View>
    </View>
  );
}

/** One step above the 12pt count text, so the glyph reads at the same weight. */
const ICON_SIZE = 13;

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  count: { ...Typography.small, fontVariant: ['tabular-nums'] },
});
