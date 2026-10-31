import { BottomSheetModal } from "@/components/ui/bottom-sheet-modal";
import {
  CREDIT_TIERS,
  getCreditTierRange,
  type CreditTierKey,
} from "@/features/profile/credit-tiers";
import { Radius, Spacing, Typography, useTheme, withAlpha } from "@/theme";
import { Ionicons } from "@expo/vector-icons";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface CreditIntroSheetProps {
  visible: boolean;
  currentTier: CreditTierKey;
  onClose: () => void;
}

interface IntroSectionProps {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  children: ReactNode;
}

type RuleTone = "success" | "danger" | "accent";

const RULE_SECTIONS: readonly {
  titleKey: string;
  listKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: RuleTone;
}[] = [
  { titleKey: "credit.sections.improve", listKey: "credit.improveRules", icon: "trending-up", tone: "success" },
  { titleKey: "credit.sections.deduct", listKey: "credit.deductRules", icon: "trending-down", tone: "danger" },
  { titleKey: "credit.sections.impact", listKey: "credit.impacts", icon: "ribbon-outline", tone: "accent" },
];

// 面板最高占屏幕的这一比例，内容再多就在面板里滚动，顶部始终露出一截页面。
const SHEET_MAX_HEIGHT_RATIO = 0.85;
// 档位从高到低排，读起来像一架梯子。
const TIERS_HIGH_TO_LOW = CREDIT_TIERS.map((tier, index) => ({ ...tier, index })).reverse();
const claimTouch = () => true;

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: Radius.full,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.md,
  },
  title: { ...Typography.h2, flexShrink: 1 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.lg,
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  noteIcon: { marginTop: 2 },
  noteText: { flex: 1, ...Typography.bodyRegular, lineHeight: 20 },
  section: { gap: Spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { ...Typography.body, fontWeight: "700" },
  sectionBody: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  tierRow: { paddingVertical: Spacing.sm + Spacing.xs, gap: Spacing.xs },
  tierDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  tierHead: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  tierTitle: { ...Typography.body, fontWeight: "700" },
  currentTag: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  currentTagText: { ...Typography.tiny, fontWeight: "700" },
  tierRange: {
    ...Typography.caption,
    marginLeft: "auto",
    fontVariant: ["tabular-nums"],
  },
  tierDetail: { ...Typography.bodyRegular, lineHeight: 20 },
  ruleRow: { flexDirection: "row", gap: Spacing.sm, paddingVertical: Spacing.sm },
  ruleDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
    marginTop: 7,
  },
  ruleText: { flex: 1, ...Typography.bodyRegular, lineHeight: 20 },
});

function useSheetColors() {
  const { colors } = useTheme();
  return useMemo(
    () => ({
      colors,
      sheet: { backgroundColor: colors.surface },
      grabber: { backgroundColor: colors.surfaceBorder },
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      closeButton: { backgroundColor: colors.surfaceMuted },
      sectionBody: { backgroundColor: colors.surfaceMuted },
      note: { backgroundColor: withAlpha(colors.primary, 0.12) },
      divider: { borderTopColor: colors.divider },
      currentTag: { backgroundColor: colors.primary },
      currentTagText: { color: colors.white },
      tone: {
        success: colors.success,
        danger: colors.danger,
        accent: colors.iconAccent,
      } satisfies Record<RuleTone, string>,
    }),
    [colors],
  );
}

function IntroSection({ icon, color, title, children }: IntroSectionProps) {
  const d = useSheetColors();
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <View style={[s.sectionIcon, { backgroundColor: withAlpha(color, 0.14) }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
        <Text style={[s.sectionTitle, d.text]}>{title}</Text>
      </View>
      <View style={[s.sectionBody, d.sectionBody]}>{children}</View>
    </View>
  );
}

/** 信誉值的档位、涨扣规则与权益说明，从信誉值页右上角「介绍」打开。 */
export function CreditIntroSheet({ visible, currentTier, onClose }: CreditIntroSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t } = useTranslation();
  const d = useSheetColors();

  // returnObjects 让整段规则数组从 i18n 取；缺 key 时兜底空数组，避免渲染崩溃。
  const getRuleList = (key: string): string[] => {
    const value = t(key, { returnObjects: true });
    return Array.isArray(value) ? (value as string[]) : [];
  };

  return (
    <BottomSheetModal visible={visible} onClose={onClose} backdropStyle={{ backgroundColor: d.colors.overlay }}>
      <View
        style={[
          s.sheet,
          d.sheet,
          { maxHeight: height * SHEET_MAX_HEIGHT_RATIO, paddingBottom: insets.bottom + Spacing.md },
        ]}
      >
        <View style={[s.grabber, d.grabber]} />
        <View style={s.header}>
          <Text style={[s.title, d.text]} accessibilityRole="header">
            {t("credit.introTitle")}
          </Text>
          <Pressable
            style={[s.closeButton, d.closeButton]}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Ionicons name="close" size={18} color={d.colors.textSecondary} />
          </Pressable>
        </View>
        <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
          {/* 面板根节点按下就会成为 JS responder（挡住蒙层的点击）；新架构下 iOS 的 ScrollView
              只要有祖先是 responder 就不让滚，正文全是纯文字时触摸会一路冒泡到面板根节点。
              由正文自己先接住触摸 —— 它在 ScrollView 里面而不是祖先，滚动才生效。 */}
          <View style={s.body} onStartShouldSetResponder={claimTouch}>
            {/* 放在最前面：打开就能看到，不必滚动。 */}
            <View style={[s.note, d.note]}>
              <Ionicons name="shield-checkmark-outline" size={18} color={d.colors.iconAccent} style={s.noteIcon} />
              <Text style={[s.noteText, d.text]}>{t("credit.introNote")}</Text>
            </View>
            <IntroSection icon="podium-outline" color={d.tone.accent} title={t("credit.sections.tiers")}>
              {TIERS_HIGH_TO_LOW.map((tier, order) => (
                <View key={tier.key} style={[s.tierRow, order > 0 && [s.tierDivider, d.divider]]}>
                  <View style={s.tierHead}>
                    <Text style={[s.tierTitle, d.text]}>{t(`credit.tier.${tier.key}.title`)}</Text>
                    {tier.key === currentTier ? (
                      <View style={[s.currentTag, d.currentTag]}>
                        <Text style={[s.currentTagText, d.currentTagText]}>{t("credit.currentTag")}</Text>
                      </View>
                    ) : null}
                    <Text style={[s.tierRange, d.secondary]}>
                      {t("credit.range", { ...getCreditTierRange(tier.index) })}
                    </Text>
                  </View>
                  <Text style={[s.tierDetail, d.secondary]}>{t(`credit.tier.${tier.key}.detail`)}</Text>
                </View>
              ))}
            </IntroSection>
            {RULE_SECTIONS.map((section) => (
              <IntroSection
                key={section.listKey}
                icon={section.icon}
                color={d.tone[section.tone]}
                title={t(section.titleKey)}
              >
                {getRuleList(section.listKey).map((rule) => (
                  <View key={rule} style={s.ruleRow}>
                    <View style={[s.ruleDot, { backgroundColor: d.tone[section.tone] }]} />
                    <Text style={[s.ruleText, d.secondary]}>{rule}</Text>
                  </View>
                ))}
              </IntroSection>
            ))}
          </View>
        </ScrollView>
      </View>
    </BottomSheetModal>
  );
}
