import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const RULE_KEYS = [
  'profile.memberRules.rules.levels',
  'profile.memberRules.rules.highTier',
  'profile.memberRules.rules.consume',
  'profile.memberRules.rules.irreversible',
];

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  rule: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginTop: 6,
  },
  ruleText: {
    flex: 1,
  },
});

export default function MemberRulesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      },
      content: {
        paddingBottom: insets.bottom + Spacing.xl,
      },
      title: {
        color: colors.text,
        ...Typography.h1,
      },
      desc: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        lineHeight: 22,
      },
      card: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      dot: {
        backgroundColor: colors.primary,
      },
      ruleText: {
        color: colors.text,
        ...Typography.bodyRegular,
        lineHeight: 22,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  return (
    <View style={d.container}>
      <NavHeader title={t('profile.memberRules.title', { defaultValue: '规则和权限说明' })} />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        <Text style={d.title}>
          {t('profile.memberRules.heading', { defaultValue: '会员规则' })}
        </Text>
        <Text style={d.desc}>
          {t('profile.memberRules.description', {
            defaultValue:
              '以下规则用于说明会员等级、积分兑换和权限范围。支付、订单和有效期将在后续接入真实后端。',
          })}
        </Text>
        <View style={[s.card, d.card]}>
          {RULE_KEYS.map((ruleKey) => (
            <View key={ruleKey} style={s.rule}>
              <View style={[s.dot, d.dot]} />
              <Text style={[s.ruleText, d.ruleText]}>{t(ruleKey)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
