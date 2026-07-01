import { NavHeader } from "@/components/ui/nav-header";
import { useAuthStore } from "@/stores/authStore";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// 只保留阈值与档位「键」在代码里；所有可见文案走 i18n（credit.tier.* 等）。
type CreditTierKey = "excellent" | "good" | "basic" | "low";

const SCORE_TIERS: readonly { min: number; key: CreditTierKey }[] = [
  { min: 90, key: "excellent" },
  { min: 75, key: "good" },
  { min: 60, key: "basic" },
  { min: 0, key: "low" },
];

const NEXT_THRESHOLDS: readonly { min: number; key: CreditTierKey }[] = [
  { min: 60, key: "basic" },
  { min: 75, key: "good" },
  { min: 90, key: "excellent" },
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
  const { t } = useTranslation();
  const creditScore = useAuthStore((state) => state.user?.creditScore ?? 0);
  const score = clampCreditScore(creditScore);
  const tier = useMemo(() => getTier(score), [score]);
  const nextTier = useMemo(() => getNextThreshold(score), [score]);
  const progressRemainder = Math.max(0, 100 - score);

  // returnObjects 让整段规则数组从 i18n 取；缺 key 时兜底空数组，避免渲染崩溃。
  const getRuleList = (key: string): string[] => {
    const value = t(key, { returnObjects: true });
    return Array.isArray(value) ? (value as string[]) : [];
  };

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
    ? t("credit.toNext", {
        title: t(`credit.tier.${nextTier.key}.title`),
        points: nextTier.min - score,
      })
    : t("credit.maxReached");

  const renderRules = (rules: string[]) =>
    rules.map((rule) => (
      <View key={rule} style={s.ruleRow}>
        <View style={[s.dot, d.dot]} />
        <Text style={[s.ruleText, d.ruleText]}>{rule}</Text>
      </View>
    ));

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t("credit.title")} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={[s.hero, d.hero]}>
          <View style={s.heroHeader}>
            <View>
              <Text style={d.label}>{t("credit.current")}</Text>
              <View style={s.scoreRow}>
                <Text style={[s.scoreValue, d.scoreValue]}>{score}</Text>
                <Text style={d.scoreUnit}>{t("credit.unit")}</Text>
              </View>
            </View>
            <View style={[s.statusPill, d.statusPill]}>
              <Text style={d.statusText}>{t(`credit.tier.${tier.key}.title`)}</Text>
            </View>
          </View>
          <Text style={d.description}>{t(`credit.tier.${tier.key}.detail`)}</Text>
          <View>
            <Text style={d.label}>{t("credit.upgradeTitle")}</Text>
            <View style={[s.progressTrack, d.progressTrack]}>
              <View style={[s.progressFill, d.progressFill, { flex: score }]} />
              <View style={{ flex: progressRemainder }} />
            </View>
            <Text style={d.description}>{upgradeText}</Text>
          </View>
        </View>

        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t("credit.sections.improve")}</Text>
          {renderRules(getRuleList("credit.improveRules"))}
        </View>

        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t("credit.sections.deduct")}</Text>
          {renderRules(getRuleList("credit.deductRules"))}
        </View>

        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t("credit.sections.impact")}</Text>
          {renderRules(getRuleList("credit.impacts"))}
        </View>

        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t("credit.sections.recent")}</Text>
          {renderRules(getRuleList("credit.recentRecords"))}
        </View>
      </ScrollView>
    </View>
  );
}
