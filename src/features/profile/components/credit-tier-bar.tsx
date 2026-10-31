import {
  CREDIT_TIERS,
  getCreditTierEnd,
} from "@/features/profile/credit-tiers";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

interface CreditTierBarProps {
  score: number;
  tierIndex: number;
}

// 段与段之间留缝，刻度行用同样的缝，档位起点数字才能对齐到各段左沿。
const SEGMENT_GAP = 4;

const s = StyleSheet.create({
  container: { gap: Spacing.sm },
  row: { flexDirection: "row", gap: SEGMENT_GAP },
  segment: {
    height: 8,
    borderRadius: Radius.full,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: Radius.full },
  tick: {
    ...Typography.small,
    fontVariant: ["tabular-nums"],
  },
  tickActive: { fontWeight: "700" },
});

/** 按档位分段的进度条：各段宽度与分数区间成比例，填充到当前分数。 */
export function CreditTierBar({ score, tierIndex }: CreditTierBarProps) {
  const { colors } = useTheme();
  const d = useMemo(
    () => ({
      segment: { backgroundColor: colors.surfaceBorder },
      fill: { backgroundColor: colors.primary },
      tick: { color: colors.textSecondary },
      tickActive: { color: colors.text },
    }),
    [colors],
  );

  const spans = CREDIT_TIERS.map((tier, index) => {
    const end = getCreditTierEnd(index);
    const filled = Math.max(0, Math.min(1, (score - tier.min) / (end - tier.min)));
    return { key: tier.key, min: tier.min, width: end - tier.min, filled };
  });

  return (
    <View style={s.container}>
      <View style={s.row}>
        {spans.map((span) => (
          <View key={span.key} style={[s.segment, d.segment, { flex: span.width }]}>
            <View style={[s.fill, d.fill, { width: `${span.filled * 100}%` }]} />
          </View>
        ))}
      </View>
      <View style={s.row}>
        {spans.map((span, index) => (
          <Text
            key={span.key}
            style={[
              s.tick,
              { flex: span.width },
              index === tierIndex ? [s.tickActive, d.tickActive] : d.tick,
            ]}
          >
            {span.min}
          </Text>
        ))}
      </View>
    </View>
  );
}
