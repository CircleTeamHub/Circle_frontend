import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NoteCard } from '@/features/notes/components/NoteCard';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { NoteSummary } from '@/features/notes/types';

interface NoteRankingRowProps {
  rank: number;
  note: NoteSummary;
  onPress: (note: NoteSummary) => void;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rank: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { ...Typography.caption, fontWeight: '700', fontVariant: ['tabular-nums'] },
  card: { flex: 1 },
});

/** 榜单一行：左边名次（前三名用好评橙实心底），右边就是笔记列表的同款卡片。 */
export const NoteRankingRow = memo(function NoteRankingRow({ rank, note, onPress }: NoteRankingRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const podium = rank <= 3;
  const d = useMemo(
    () => ({
      rank: podium ? { backgroundColor: colors.ratingGood } : { backgroundColor: colors.surfaceMuted },
      rankText: { color: podium ? colors.white : colors.textSecondary },
    }),
    [colors, podium],
  );

  return (
    <View style={s.row}>
      <View
        style={[s.rank, d.rank]}
        accessible
        accessibilityLabel={t('explore.ranking.rankA11y', { defaultValue: '第 {{rank}} 名', rank })}
      >
        <Text style={[s.rankText, d.rankText]}>{rank}</Text>
      </View>
      <View style={s.card}>
        <NoteCard note={note} onPress={onPress} showActions={false} />
      </View>
    </View>
  );
});
