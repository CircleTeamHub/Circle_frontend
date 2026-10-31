import { NavHeader } from "@/components/ui/nav-header";
import { CreditIntroSheet } from "@/features/profile/components/credit-intro-sheet";
import { CreditRecentCard } from "@/features/profile/components/credit-recent-card";
import { CreditTierBar } from "@/features/profile/components/credit-tier-bar";
import {
  CREDIT_TIERS,
  clampCreditScore,
  getCreditTierIndex,
} from "@/features/profile/credit-tiers";
import { useAuthStore } from "@/stores/authStore";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const s = StyleSheet.create({
  container: { flex: 1 },
  introButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    height: 32,
    paddingHorizontal: Spacing.sm + Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  introButtonText: { ...Typography.caption, fontWeight: "600" },
  content: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  hero: { alignItems: "center" },
  scoreRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  scoreValue: {
    fontSize: 64,
    lineHeight: 72,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  tierPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm + Spacing.xs,
    paddingVertical: Spacing.xs,
    marginTop: Spacing.sm,
  },
  tierPillText: { ...Typography.caption, fontWeight: "700" },
  tierDetail: {
    ...Typography.bodyRegular,
    lineHeight: 20,
    textAlign: "center",
    marginTop: Spacing.md,
  },
  divider: {
    alignSelf: "stretch",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: Spacing.lg,
  },
  progress: { alignSelf: "stretch", gap: Spacing.md },
  upgradeRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  upgradeText: { flex: 1, ...Typography.body },
});

export default function CreditScoreScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [introVisible, setIntroVisible] = useState(false);
  const openIntro = useCallback(() => setIntroVisible(true), []);
  const closeIntro = useCallback(() => setIntroVisible(false), []);
  const creditScore = useAuthStore((state) => state.user?.creditScore ?? 0);
  const score = clampCreditScore(creditScore);
  const tierIndex = getCreditTierIndex(score);
  const tier = CREDIT_TIERS[tierIndex];
  const nextTier = CREDIT_TIERS[tierIndex + 1] ?? null;

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      introButton: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      card: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      label: { color: colors.textSecondary, ...Typography.caption },
      scoreUnit: { color: colors.textSecondary, ...Typography.body },
      tierPill: { backgroundColor: colors.primary },
      tierPillText: { color: colors.white },
      divider: { borderTopColor: colors.divider },
    }),
    [colors],
  );

  const upgradeText = nextTier
    ? t("credit.toNext", {
        title: t(`credit.tier.${nextTier.key}.title`),
        points: nextTier.min - score,
      })
    : t("credit.maxReached");

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t("credit.title")}
        rightSlot={
          <Pressable
            testID="credit-intro-button"
            style={[s.introButton, d.introButton]}
            onPress={openIntro}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("credit.introTitle")}
          >
            <Ionicons name="information-circle-outline" size={16} color={colors.iconAccent} />
            <Text style={[s.introButtonText, d.text]}>{t("credit.introButton")}</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={[s.card, s.hero, d.card]}>
          <Text style={d.label}>{t("credit.current")}</Text>
          <View style={s.scoreRow}>
            <Text style={[s.scoreValue, d.text]}>{score}</Text>
            <Text style={d.scoreUnit}>{t("credit.unit")}</Text>
          </View>
          <View style={[s.tierPill, d.tierPill]}>
            <Ionicons name="shield-checkmark" size={14} color={colors.white} />
            <Text style={[s.tierPillText, d.tierPillText]}>{t(`credit.tier.${tier.key}.title`)}</Text>
          </View>
          <Text style={[s.tierDetail, d.secondary]}>{t(`credit.tier.${tier.key}.detail`)}</Text>

          <View style={[s.divider, d.divider]} />

          <View style={s.progress}>
            <Text style={d.label}>{t("credit.upgradeTitle")}</Text>
            <CreditTierBar score={score} tierIndex={tierIndex} />
            <View style={s.upgradeRow}>
              <Ionicons
                name={nextTier ? "trending-up" : "trophy-outline"}
                size={18}
                color={colors.iconAccent}
              />
              <Text style={[s.upgradeText, d.text]}>{upgradeText}</Text>
            </View>
          </View>
        </View>

        <CreditRecentCard creditScore={score} />
      </ScrollView>

      <CreditIntroSheet visible={introVisible} currentTier={tier.key} onClose={closeIntro} />
    </View>
  );
}
