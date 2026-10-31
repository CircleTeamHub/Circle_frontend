import { useCreditEvents } from "@/features/profile/hooks/use-credit-events";
import type { CreditEvent } from "@/services/api/credit";
import { Radius, Spacing, Typography, useTheme, withAlpha } from "@/theme";
import { getLocalizedDateTimeLocale } from "@/utils/locale";
import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

interface CreditRecentCardProps {
  creditScore: number;
}

interface CreditEventRowProps {
  event: CreditEvent;
  divided: boolean;
}

// 服务端 reason → 标题词条；新来源上线前一律按「信誉值调整」展示，不露出原始枚举。
const REASON_TITLE_KEYS: Record<string, string> = {
  FRIEND_REPORT: "credit.reasons.friendReport",
};
const FALLBACK_REASON_TITLE_KEY = "credit.reasons.other";

const s = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  title: { ...Typography.body, fontWeight: "700", marginBottom: Spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rowMain: { flex: 1, gap: Spacing.xs },
  rowTitle: { ...Typography.body },
  rowMeta: { ...Typography.small },
  rowSide: { alignItems: "flex-end", gap: Spacing.xs },
  delta: { ...Typography.body, fontWeight: "700", fontVariant: ["tabular-nums"] },
  scoreAfter: { ...Typography.small, fontVariant: ["tabular-nums"] },
  status: {
    alignItems: "center",
    gap: Spacing.xs,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  statusTitle: { ...Typography.body, textAlign: "center" },
  statusHint: { ...Typography.small, textAlign: "center" },
  retryButton: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  retryText: { ...Typography.caption, fontWeight: "600" },
});

function useCardStyles() {
  const { colors } = useTheme();
  return useMemo(
    () => ({
      colors,
      card: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      divider: { borderTopColor: colors.divider },
      statusIcon: { backgroundColor: colors.surfaceMuted },
      retryButton: { backgroundColor: withAlpha(colors.primary, 0.12) },
      retryText: { color: colors.iconAccent },
    }),
    [colors],
  );
}

function CreditEventRow({ event, divided }: CreditEventRowProps) {
  const d = useCardStyles();
  const { t, i18n } = useTranslation();
  const gained = event.delta > 0;
  const tone = gained ? d.colors.success : d.colors.danger;
  const reasonTitle = t(REASON_TITLE_KEYS[event.reason] ?? FALLBACK_REASON_TITLE_KEY);
  const title = event.category
    ? `${reasonTitle} · ${t(`chat.report.categories.${event.category}.label`)}`
    : reasonTitle;
  // 不传 locale 会跟着设备语言走，应用内切过语言的人会看到两种语言混排。
  const time = new Date(event.createdAt).toLocaleString(
    getLocalizedDateTimeLocale(i18n.language),
    { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" },
  );

  return (
    <View style={[s.row, divided && [s.rowDivider, d.divider]]}>
      <View style={[s.rowIcon, { backgroundColor: withAlpha(tone, 0.14) }]}>
        <Ionicons name={gained ? "trending-up" : "trending-down"} size={16} color={tone} />
      </View>
      <View style={s.rowMain}>
        <Text style={[s.rowTitle, d.text]} numberOfLines={1}>{title}</Text>
        <Text style={[s.rowMeta, d.secondary]}>{time}</Text>
      </View>
      <View style={s.rowSide}>
        <Text style={[s.delta, { color: tone }]}>{gained ? `+${event.delta}` : event.delta}</Text>
        <Text style={[s.scoreAfter, d.secondary]}>
          {t("credit.scoreAfter", { score: event.scoreAfter })}
        </Text>
      </View>
    </View>
  );
}

/** 信誉值页「近期记录」：真实的加分/扣分流水，含加载、失败重试与空状态。 */
export function CreditRecentCard({ creditScore }: CreditRecentCardProps) {
  const d = useCardStyles();
  const { t } = useTranslation();
  const { events, loading, failed, retry } = useCreditEvents(creditScore);

  const renderStatus = () => {
    if (!events && (loading || !failed)) {
      return <ActivityIndicator style={s.status} color={d.colors.textSecondary} />;
    }
    if (!events) {
      return (
        <View style={s.status}>
          <Text style={[s.statusTitle, d.text]}>{t("credit.recentLoadFailed")}</Text>
          <Pressable
            style={[s.retryButton, d.retryButton]}
            onPress={retry}
            accessibilityRole="button"
          >
            <Text style={[s.retryText, d.retryText]}>{t("common.retry")}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={s.status}>
        <View style={[s.statusIcon, d.statusIcon]}>
          <Ionicons name="time-outline" size={20} color={d.colors.textSecondary} />
        </View>
        <Text style={[s.statusTitle, d.text]}>{t("credit.recentEmpty")}</Text>
        <Text style={[s.statusHint, d.secondary]}>{t("credit.recentEmptyHint")}</Text>
      </View>
    );
  };

  return (
    <View style={[s.card, d.card]}>
      <Text style={[s.title, d.text]}>{t("credit.sections.recent")}</Text>
      {events && events.length > 0
        ? events.map((event, index) => (
            <CreditEventRow key={event.id} event={event} divided={index > 0} />
          ))
        : renderStatus()}
    </View>
  );
}
