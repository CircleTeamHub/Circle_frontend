import { memo, useId, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { NOTE_RATING_BAD_ICON } from '@/features/notes/components/NoteRatingCounts';
import { Gradients, Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import type { NoteRankingBoard } from '@/features/notes/types';

const ICON_BADGE_SIZE = 48;
const SEGMENT_HEIGHT = 36;

const s = StyleSheet.create({
  shell: { borderRadius: Radius.xxl, overflow: 'hidden' },
  content: { padding: Spacing.md, gap: Spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md - Spacing.xs },
  iconBadge: {
    width: ICON_BADGE_SIZE,
    height: ICON_BADGE_SIZE,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1, gap: 2 },
  title: { ...Typography.h2, lineHeight: 28 },
  caption: { ...Typography.small, lineHeight: 16 },
  // 胶囊分段：全国 | 城市。选中的那段是白底、榜单色的字（好评橙 / 差评蓝）。
  segment: { flexDirection: 'row', borderRadius: Radius.full, padding: Spacing.xs },
  segmentItem: {
    flex: 1,
    height: SEGMENT_HEIGHT,
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  segmentText: { ...Typography.caption, fontWeight: '700', flexShrink: 1 },
});

interface NoteRankingHeroProps {
  board: NoteRankingBoard;
  /** 榜单月份（1–12）；还没拉到时为 null。 */
  month: number | null;
  /** 当前筛选的城市；null = 全国。 */
  city: string | null;
  /** 城市那一段显示的名字：当前城市，或上次看过的城市；都没有就提示去选。 */
  cityLabel: string | null;
  onNationwide: () => void;
  onCity: () => void;
}

/**
 * 大众点评榜单页头，下面是全国 / 城市切换。好评榜与探索页入口磁贴同一条好评橙 → 热度红渐变、
 * 奖杯；差评榜换成乌云灰蓝 → 雨云蓝、差评的雨云图标。
 */
export const NoteRankingHero = memo(function NoteRankingHero({
  board,
  month,
  city,
  cityLabel,
  onNationwide,
  onCity,
}: NoteRankingHeroProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const gradientId = `ranking-hero-${useId().replace(/:/g, '')}`;
  const nationwide = city === null;
  const nationwideLabel = t('explore.ranking.nationwide', { defaultValue: '全国' });
  const bad = board === 'bad';
  const gradient = bad ? Gradients.exploreRankingBad : Gradients.exploreRanking;
  const accent = bad ? colors.ratingBad : colors.ratingGood;
  let title: string;
  if (bad) {
    title = month
      ? t('explore.ranking.heroTitleBad', { defaultValue: '{{month}} 月差评榜', month })
      : t('explore.ranking.heroTitleBadNoMonth', { defaultValue: '本月差评榜' });
  } else {
    title = month
      ? t('explore.ranking.heroTitle', { defaultValue: '{{month}} 月好评榜', month })
      : t('explore.ranking.heroTitleNoMonth', { defaultValue: '本月好评榜' });
  }

  const d = useMemo(
    () => ({
      iconBadge: { backgroundColor: withAlpha(colors.white, 0.22) },
      title: { color: colors.white },
      caption: { color: withAlpha(colors.white, 0.86) },
      segment: { backgroundColor: withAlpha(colors.black, 0.14) },
      active: { backgroundColor: colors.white },
      activeText: { color: accent },
      idleText: { color: colors.white },
    }),
    [accent, colors],
  );

  return (
    <View style={s.shell}>
      {/* 宽高要写明：网页上的 <svg> 不写就按 300×150 画，渐变只铺到一角。 */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={gradient[0]} />
            <Stop offset="1" stopColor={gradient[1]} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
        {/* 右上角两圈淡淡的光斑，和探索页磁贴的装饰同一个意思。 */}
        <Circle cx="92%" cy="8%" r="64" fill={colors.white} fillOpacity={0.1} />
        <Circle cx="78%" cy="-10%" r="40" fill={colors.white} fillOpacity={0.08} />
      </Svg>
      <View style={s.content}>
        <View style={s.titleRow}>
          <View style={[s.iconBadge, d.iconBadge]}>
            {bad ? (
              <MaterialCommunityIcons name={NOTE_RATING_BAD_ICON} size={24} color={colors.white} />
            ) : (
              <Ionicons name="trophy" size={24} color={colors.white} />
            )}
          </View>
          <View style={s.titles}>
            <Text style={[s.title, d.title]} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
            <Text style={[s.caption, d.caption]} numberOfLines={1}>
              {t('explore.ranking.heroCaption', {
                defaultValue: '{{scope}} · 每月 1 号重新排',
                scope: city ?? nationwideLabel,
              })}
            </Text>
          </View>
        </View>
        <View style={[s.segment, d.segment]} accessibilityRole="tablist">
          <Pressable
            style={[s.segmentItem, nationwide && d.active]}
            onPress={onNationwide}
            accessibilityRole="tab"
            accessibilityState={{ selected: nationwide }}
          >
            <Text style={[s.segmentText, nationwide ? d.activeText : d.idleText]}>{nationwideLabel}</Text>
          </Pressable>
          <Pressable
            style={[s.segmentItem, !nationwide && d.active]}
            onPress={onCity}
            accessibilityRole="tab"
            accessibilityState={{ selected: !nationwide }}
          >
            <Ionicons
              name="location"
              size={14}
              color={nationwide ? colors.white : accent}
            />
            <Text style={[s.segmentText, nationwide ? d.idleText : d.activeText]} numberOfLines={1}>
              {cityLabel ?? t('explore.ranking.chooseCity', { defaultValue: '选择城市' })}
            </Text>
            <Ionicons
              name="chevron-down"
              size={13}
              color={nationwide ? colors.white : accent}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
});
