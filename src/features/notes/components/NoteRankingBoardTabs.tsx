import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  NOTE_RATING_BAD_ICON,
  NOTE_RATING_GOOD_ICON,
} from '@/features/notes/components/NoteRatingCounts';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { NoteRankingBoard } from '@/features/notes/types';

const TAB_HEIGHT = 36;
const ICON_SIZE = 16;

const s = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: Radius.full, padding: Spacing.xs },
  tab: {
    flex: 1,
    height: TAB_HEIGHT,
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  label: { ...Typography.caption, fontWeight: '700', flexShrink: 1 },
});

interface NoteRankingBoardTabsProps {
  board: NoteRankingBoard;
  onChange: (board: NoteRankingBoard) => void;
}

/** 榜单页最上面的切换：好评榜（礼花）| 差评榜（雨云），图标与笔记卡片上的好评 / 差评同一对。 */
export const NoteRankingBoardTabs = memo(function NoteRankingBoardTabs({
  board,
  onChange,
}: NoteRankingBoardTabsProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      track: { backgroundColor: colors.surfaceMuted },
      active: { backgroundColor: colors.surface },
      activeLabel: { color: colors.text },
      idleLabel: { color: colors.textSecondary },
    }),
    [colors],
  );
  const tabs = [
    {
      board: 'good',
      icon: NOTE_RATING_GOOD_ICON,
      tint: colors.ratingGood,
      label: t('explore.ranking.boardGood', { defaultValue: '好评榜' }),
    },
    {
      board: 'bad',
      icon: NOTE_RATING_BAD_ICON,
      tint: colors.ratingBad,
      label: t('explore.ranking.boardBad', { defaultValue: '差评榜' }),
    },
  ] as const;

  return (
    <View style={[s.track, d.track]} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = tab.board === board;
        return (
          <Pressable
            key={tab.board}
            style={[s.tab, selected && d.active]}
            onPress={() => onChange(tab.board)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <MaterialCommunityIcons
              name={tab.icon}
              size={ICON_SIZE}
              color={selected ? tab.tint : colors.textSecondary}
            />
            <Text style={[s.label, selected ? d.activeLabel : d.idleLabel]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});
