import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

// 玩法步骤按序渲染；文案在 i18n 的 discover.guide.step1..4（各语言齐全）。
const STEP_KEYS = [
  'discover.guide.step1',
  'discover.guide.step2',
  'discover.guide.step3',
  'discover.guide.step4',
] as const;

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  intro: {
    ...Typography.body,
    lineHeight: 22,
    paddingTop: Spacing.md,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h3,
  },
  sectionIntro: {
    ...Typography.caption,
    lineHeight: 20,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  swatch: {
    width: 16,
    height: 16,
    borderRadius: Radius.sm,
  },
  colorText: {
    flex: 1,
    ...Typography.body,
    lineHeight: 22,
  },
  stepRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  stepNum: {
    ...Typography.body,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    ...Typography.body,
    lineHeight: 22,
  },
});

export default function CircleGuideScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  // 色块与活动卡片强调竖条一一对应：紫=充裕 / 绿=临近 / 橙=紧急。
  const colorItems = useMemo(
    () => [
      { key: 'discover.guide.colorPurple', color: colors.primary },
      { key: 'discover.guide.colorGreen', color: colors.success },
      { key: 'discover.guide.colorOrange', color: colors.warning },
    ],
    [colors],
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      intro: { color: colors.textSecondary },
      card: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      title: { color: colors.text },
      sub: { color: colors.textSecondary },
      body: { color: colors.text },
      num: { color: colors.primary },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('discover.guide.title')} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.intro, d.intro]}>{t('discover.guide.intro')}</Text>

        {/* 卡片颜色说明 */}
        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.title]}>
            {t('discover.guide.colorsTitle')}
          </Text>
          <Text style={[s.sectionIntro, d.sub]}>
            {t('discover.guide.colorsIntro')}
          </Text>
          {colorItems.map((item) => (
            <View key={item.key} style={s.colorRow}>
              <View style={[s.swatch, { backgroundColor: item.color }]} />
              <Text style={[s.colorText, d.body]}>{t(item.key)}</Text>
            </View>
          ))}
        </View>

        {/* 玩法步骤 */}
        <View style={[s.card, d.card]}>
          <Text style={[s.sectionTitle, d.title]}>
            {t('discover.guide.stepsTitle')}
          </Text>
          {STEP_KEYS.map((key, index) => (
            <View key={key} style={s.stepRow}>
              <Text style={[s.stepNum, d.num]}>{index + 1}.</Text>
              <Text style={[s.stepText, d.body]}>{t(key)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
