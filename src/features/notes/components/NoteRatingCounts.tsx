import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Typography, useTheme } from '@/theme';

/** 好评 is a party popper (礼花), 差评 a rain cloud: the same pair in every rating entry point. */
export const NOTE_RATING_GOOD_ICON = 'party-popper' as const;
export const NOTE_RATING_BAD_ICON = 'weather-pouring' as const;

interface NoteRatingCountsProps {
  goodCount?: number;
  badCount?: number;
  /** 数字的颜色;两个图标固定用自己的彩色(好评橙、差评蓝)。 */
  color: string;
  /** 落在紫色已发送气泡上:图标换浅色版,否则蓝色雨云在紫底上几乎看不见。 */
  onAccent?: boolean;
  testID?: string;
}

/**
 * The 好评 / 差评 area (this month's counters of the source note) on list and
 * chat note cards: icon, then the number. Zeros are shown too, so every card
 * has the same layout. 礼花是橙色、雨云是蓝色,一眼分出好坏。
 */
export function NoteRatingCounts({ goodCount = 0, badCount = 0, color, onAccent = false, testID }: NoteRatingCountsProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const goodIconColor = onAccent ? colors.ratingGoodOnAccent : colors.ratingGood;
  const badIconColor = onAccent ? colors.ratingBadOnAccent : colors.ratingBad;
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
        <MaterialCommunityIcons name={NOTE_RATING_GOOD_ICON} size={ICON_SIZE} color={goodIconColor} />
        <Text style={[s.count, { color }]} testID={testID ? `${testID}-good` : undefined}>
          {goodCount}
        </Text>
      </View>
      <View style={s.item}>
        <MaterialCommunityIcons name={NOTE_RATING_BAD_ICON} size={ICON_SIZE} color={badIconColor} />
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
