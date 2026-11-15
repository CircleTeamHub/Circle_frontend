import { memo, useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';
import { Gradients, Typography, useTheme } from '@/theme';

/** 名次列宽：奖牌和两位数的斜体数字都放得下。 */
export const RANK_BADGE_WIDTH = 32;
/** 奖牌画布：上面是两条绶带，下面压着圆形奖牌。 */
const MEDAL_HEIGHT = 40;
const MEDAL_CENTER_Y = 25;
const MEDAL_RADIUS = 14;

const MEDALS = [Gradients.rankGold, Gradients.rankSilver, Gradients.rankBronze] as const;

const s = StyleSheet.create({
  medal: { width: RANK_BADGE_WIDTH, height: MEDAL_HEIGHT },
  // 数字压在奖牌圆心上。
  medalNumber: {
    position: 'absolute',
    top: MEDAL_CENTER_Y - MEDAL_RADIUS,
    left: 0,
    right: 0,
    height: MEDAL_RADIUS * 2,
    textAlign: 'center',
    lineHeight: MEDAL_RADIUS * 2,
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1.5,
  },
  plain: { width: RANK_BADGE_WIDTH, alignItems: 'center' },
  plainNumber: {
    ...Typography.h2,
    lineHeight: 26,
    fontWeight: '800',
    fontStyle: 'italic',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
});

/**
 * 奖牌圆心 / 斜体数字的中线距组件顶部多远：行组件据此把名次和卡片标题行对齐。
 */
export function rankBadgeCenterY(rank: number) {
  return rank <= 3 ? MEDAL_CENTER_Y : 13;
}

/** 榜单名次：前三名是金 / 银 / 铜奖牌（挂两条好评橙、热度红的绶带），其余是粗斜体数字。 */
export const NoteRankBadge = memo(function NoteRankBadge({ rank }: { rank: number }) {
  const { colors } = useTheme();
  const gradientId = `rank-medal-${useId().replace(/:/g, '')}`;

  if (rank > 3) {
    return (
      <View style={s.plain}>
        <Text style={[s.plainNumber, { color: colors.textSecondary }]}>{rank}</Text>
      </View>
    );
  }

  const [light, dark] = MEDALS[rank - 1];
  const cx = RANK_BADGE_WIDTH / 2;
  return (
    <View style={s.medal}>
      <Svg width={RANK_BADGE_WIDTH} height={MEDAL_HEIGHT}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={light} />
            <Stop offset="1" stopColor={dark} />
          </LinearGradient>
        </Defs>
        {/* 两条绶带从顶上斜着收进奖牌后面。 */}
        <Polygon points={`${cx - 10},0 ${cx - 3},0 ${cx + 3},16 ${cx - 4},16`} fill={Gradients.exploreRanking[1]} />
        <Polygon points={`${cx + 3},0 ${cx + 10},0 ${cx + 4},16 ${cx - 3},16`} fill={Gradients.exploreRanking[0]} />
        <Circle cx={cx} cy={MEDAL_CENTER_Y} r={MEDAL_RADIUS} fill={`url(#${gradientId})`} />
        {/* 内圈细描边：金属奖牌的压边。 */}
        <Circle
          cx={cx}
          cy={MEDAL_CENTER_Y}
          r={MEDAL_RADIUS - 3}
          fill="none"
          stroke={colors.white}
          strokeOpacity={0.55}
          strokeWidth={1.2}
        />
      </Svg>
      <Text style={[s.medalNumber, { color: colors.white }]}>{rank}</Text>
    </View>
  );
});
