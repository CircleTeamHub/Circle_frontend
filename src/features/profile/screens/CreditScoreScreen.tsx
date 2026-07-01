import { NavHeader } from "@/components/ui/nav-header";
import { useAuthStore } from "@/stores/authStore";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SCORE_TIERS = [
  { min: 90, title: "优秀信誉", detail: "可优先参与高门槛活动、合作和圈子报名。" },
  { min: 75, title: "良好信誉", detail: "信誉状态稳定，可参与大多数活动和社交协作。" },
  { min: 60, title: "基础信誉", detail: "保持真实资料和正常履约，可继续积累信誉。" },
  { min: 0, title: "需要提升", detail: "建议完善资料、减少爽约和违规记录。" },
] as const;

const NEXT_THRESHOLDS = [
  { min: 60, title: "基础信誉" },
  { min: 75, title: "良好信誉" },
  { min: 90, title: "优秀信誉" },
] as const;

const IMPROVE_RULES = [
  "完善真实资料、头像和常用联系方式",
  "按时参加已报名活动并获得正向评价",
  "持续发布真实内容，减少被举报或隐藏记录",
];

const DEDUCT_RULES = [
  "恶意刷屏、虚假资料、诱导交易会触发扣分",
  "报名后多次爽约或被主办方投诉会影响信誉",
  "严重违规会限制报名、私信和部分圈子功能",
];

const IMPACTS = [
  "报名门槛可按 VIP 等级和信誉值共同判断",
  "高信誉用户可展示更高可信度标签",
  "低信誉时部分活动可能需要人工审核",
];

const RECENT_RECORDS = [
  "暂无近期信誉变动记录",
  "后续会接入真实加分、扣分和申诉流水",
];

function clampCreditScore(score: number) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.floor(score)));
}

function getTier(score: number) {
  return SCORE_TIERS.find((tier) => score >= tier.min) ?? SCORE_TIERS[SCORE_TIERS.length - 1];
}

function getNextThreshold(score: number) {
  return NEXT_THRESHOLDS.find((tier) => score < tier.min) ?? null;
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  hero: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  heroHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  scoreRow: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  scoreValue: {
    fontSize: 48,
    lineHeight: 54,
    fontWeight: "800",
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    flexDirection: "row",
  },
  progressFill: { borderRadius: 999 },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  sectionTitle: { ...Typography.h3 },
  ruleRow: { flexDirection: "row", gap: Spacing.sm },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    marginTop: 8,
  },
  ruleText: { flex: 1, ...Typography.body },
});

export default function CreditScoreScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const creditScore = useAuthStore((state) => state.user?.creditScore ?? 0);
  const score = clampCreditScore(creditScore);
  const tier = useMemo(() => getTier(score), [score]);
  const nextTier = useMemo(() => getNextThreshold(score), [score]);
  const progressRemainder = Math.max(0, 100 - score);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      hero: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      label: { color: colors.textSecondary, ...Typography.caption },
      scoreValue: { color: colors.text },
      scoreUnit: { color: colors.textSecondary, ...Typography.small },
      statusPill: { backgroundColor: colors.primary },
      statusText: { color: colors.white, ...Typography.small, fontWeight: "700" as const },
      description: { color: colors.textSecondary, ...Typography.body },
      progressTrack: { backgroundColor: colors.surfaceBorder },
      progressFill: { backgroundColor: colors.primary },
      card: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      sectionTitle: { color: colors.text },
      dot: { backgroundColor: colors.primary },
      ruleText: { color: colors.textSecondary },
    }),
    [colors],
  );

  const upgradeText = nextTier
    ? `距离 ${nextTier.title} 还差 ${nextTier.min - score} 分`
    : "已达到当前最高信誉档位";

  const renderRules = (rules: string[]) =>
    rules.map((rule) => (
      <View key={rule} style={s.ruleRow}>
        <View style={[s.dot, d.dot]} />
        <Text style={[s.ruleText, d.ruleText]}>{rule}</Text>
      </View>
    ));

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title="信誉值详情" />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={[s.hero, d.hero]}>
          <View style={s.heroHeader}>
            <View>
              <Text style={d.label}>当前信誉值</Text>
              <View style={s.scoreRow}>
                <Text style={[s.scoreValue, d.scoreValue]}>{score}</Text>
                <Text style={d.scoreUnit}>/ 100</Text>
              </View>
            </View>
            <View style={[s.statusPill, d.statusPill]}>
              <Text style={d.statusText}>{tier.title}</Text>
            </View>
          </View>
          <Text style={d.description}>{tier.detail}</Text>
          <View>
            <Text style={d.label}>升级情况</Text>
            <View style={[s.progressTrack, d.progressTrack]}>
              <View style={[s.progressFill, d.progressFill, { flex: score }]} />
              <View style={{ flex: progressRemainder }} />
            </View>
            <Text style={d.description}>{upgradeText}</Text>
          </View>
        </View>

        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>如何提升</Text>
          {renderRules(IMPROVE_RULES)}
        </View>

        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>扣分规则</Text>
          {renderRules(DEDUCT_RULES)}
        </View>

        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>权益影响</Text>
          {renderRules(IMPACTS)}
        </View>

        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>近期记录</Text>
          {renderRules(RECENT_RECORDS)}
        </View>
      </ScrollView>
    </View>
  );
}
